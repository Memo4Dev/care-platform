import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import type { Channel, DatabaseClient, PriceType } from '@commerce-platform/database';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or, isNull, sql } from 'drizzle-orm';
import { coupons, priceBooks, priceEntries, promotions } from '@commerce-platform/database';

import { DATABASE } from '../../database/database.tokens';
import { resolvePriceQuote, type PriceEntryRecord } from '../domain/quote';
import {
  type PricingContracts,
  type PriceQuoteView,
  type CouponView,
  type PromotionView,
  type TaxPricingResult,
} from '../contracts';

// ---------------------------------------------------------------------------
// Helpers: Drizzle `date()` returns string, domain uses Date
// ---------------------------------------------------------------------------

function toDateOrNull(value: string | null): Date | null {
  if (value === null) return null;
  return new Date(value + 'T00:00:00.000Z');
}

function toDateString(date: Date | null): string | null {
  if (date === null) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Read-model implementation of the Pricing module contract.
 *
 * Deliberately queries projections directly (SELECT-only) instead of loading
 * aggregates: contract reads must stay cheap for hot paths such as POS
 * checkout and pricing resolution. All access is organizationId-scoped.
 */
@Injectable()
export class PricingContractProvider implements PricingContracts {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  async getPriceQuote(
    organizationId: string,
    input: {
      variantId: string;
      unitId: string;
      priceType: PriceType;
      channel: Channel;
      branchId?: string;
      effectiveDate?: string;
    },
  ): Promise<PriceQuoteView> {
    const effectiveDate = input.effectiveDate ? new Date(input.effectiveDate) : new Date();

    // Load default price book
    const [defaultBook] = await this.db
      .select({ id: priceBooks.id })
      .from(priceBooks)
      .where(and(eq(priceBooks.organizationId, organizationId), eq(priceBooks.isDefault, true)))
      .limit(1);

    if (!defaultBook) {
      throw PlatformError.of(
        ERROR_CODES.PRICE_NOT_AVAILABLE,
        `No default price book configured for organization.`,
        { details: { organizationId } },
      );
    }

    // Fetch active entries for the variant
    const dateStr = toDateString(effectiveDate);
    const rows = await this.db
      .select()
      .from(priceEntries)
      .where(
        and(
          eq(priceEntries.organizationId, organizationId),
          eq(priceEntries.variantId, input.variantId),
          eq(priceEntries.unitId, input.unitId),
          eq(priceEntries.priceType, input.priceType),
          eq(priceEntries.channel, input.channel),
          or(isNull(priceEntries.effectiveFrom), sql`${priceEntries.effectiveFrom} <= ${dateStr}`),
          or(isNull(priceEntries.effectiveTo), sql`${priceEntries.effectiveTo} > ${dateStr}`),
        ),
      );

    const entries: PriceEntryRecord[] = rows.map((row) => ({
      variantId: row.variantId,
      unitId: row.unitId,
      priceType: row.priceType as PriceType,
      channel: row.channel as Channel,
      branchId: row.branchId,
      amount: row.amount,
      effectiveFrom: toDateOrNull(row.effectiveFrom),
      effectiveTo: toDateOrNull(row.effectiveTo),
    }));

    const quote = resolvePriceQuote(
      {
        variantId: input.variantId,
        unitId: input.unitId,
        priceType: input.priceType,
        channel: input.channel,
        branchId: input.branchId,
        effectiveDate,
      },
      entries,
    );

    return {
      amount: quote.amount,
      priceType: quote.priceType,
      channel: quote.channel,
      source: quote.source,
    };
  }

  async validateCoupon(organizationId: string, code: string): Promise<CouponView> {
    const [row] = await this.db
      .select()
      .from(coupons)
      .where(and(eq(coupons.organizationId, organizationId), eq(coupons.code, code.toUpperCase())))
      .limit(1);

    if (!row) {
      throw PlatformError.of(ERROR_CODES.COUPON_INVALID, `Coupon "${code}" not found.`, {
        details: { code },
      });
    }

    const now = new Date();
    const nowStr = toDateString(now);
    const isActive = row.isActive;
    const afterStart = row.startDate === null || row.startDate <= (nowStr ?? '');
    const beforeEnd = row.endDate === null || row.endDate > (nowStr ?? '');
    const withinUsage = row.maxUses === null || row.usedCount < row.maxUses;
    const isValid = isActive && afterStart && beforeEnd && withinUsage;

    return {
      id: row.id,
      organizationId: row.organizationId,
      code: row.code,
      type: row.type,
      value: row.value,
      promotionId: row.promotionId ?? '',
      maxUses: row.maxUses,
      usedCount: row.usedCount,
      minOrderAmount: row.minOrderAmount,
      isActive: row.isActive,
      isValid,
    };
  }

  async evaluatePromotion(organizationId: string, promotionId: string): Promise<PromotionView> {
    const [row] = await this.db
      .select()
      .from(promotions)
      .where(and(eq(promotions.id, promotionId), eq(promotions.organizationId, organizationId)))
      .limit(1);

    if (!row) {
      throw PlatformError.notFound(`Promotion ${promotionId} was not found.`, {
        details: { promotionId, organizationId },
      });
    }

    const now = new Date();
    const nowStr = toDateString(now);
    const isActive = row.isActive;
    const afterStart = row.startDate === null || row.startDate <= (nowStr ?? '');
    const beforeEnd = row.endDate === null || row.endDate > (nowStr ?? '');
    const isValidAtDate = isActive && afterStart && beforeEnd;

    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      type: row.type,
      target: row.target,
      value: row.value,
      minQuantity: row.minQuantity,
      maxQuantity: row.maxQuantity,
      isActive: row.isActive,
      isValidAtDate,
    };
  }

  async calculateTaxPricingResult(
    _organizationId: string,
    input: {
      variantId: string;
      unitId: string;
      priceType: PriceType;
      channel: Channel;
      branchId?: string;
      quantity: string;
      promotionId?: string;
      couponCode?: string;
    },
  ): Promise<TaxPricingResult> {
    // Resolve base price
    const quote = await this.getPriceQuote(_organizationId, {
      variantId: input.variantId,
      unitId: input.unitId,
      priceType: input.priceType,
      channel: input.channel,
      branchId: input.branchId,
    });

    const baseAmount = Number(quote.amount) * Number(input.quantity);
    let discountAmount = 0;

    // Apply promotion discount if provided
    if (input.promotionId) {
      const promo = await this.evaluatePromotion(_organizationId, input.promotionId);
      if (promo.isActive && promo.isValidAtDate) {
        if (promo.type === 'PERCENTAGE') {
          discountAmount = baseAmount * (Number(promo.value) / 100);
        } else if (promo.type === 'FIXED_AMOUNT') {
          discountAmount = Number(promo.value);
        }
      }
    }

    // Apply coupon discount if provided
    if (input.couponCode) {
      const coupon = await this.validateCoupon(_organizationId, input.couponCode);
      if (coupon.isValid) {
        if (coupon.type === 'PERCENTAGE') {
          discountAmount += (baseAmount - discountAmount) * (Number(coupon.value) / 100);
        } else if (coupon.type === 'FIXED_AMOUNT') {
          discountAmount += Number(coupon.value);
        }
      }
    }

    // Clamp discount to non-negative
    discountAmount = Math.max(0, discountAmount);
    const taxableAmount = baseAmount - discountAmount;
    // Placeholder: tax calculation would integrate with a tax engine
    const taxAmount = 0;
    const totalAmount = taxableAmount + taxAmount;

    return {
      baseAmount: baseAmount.toFixed(4),
      discountAmount: discountAmount.toFixed(4),
      taxAmount: taxAmount.toFixed(4),
      totalAmount: totalAmount.toFixed(4),
    };
  }
}
