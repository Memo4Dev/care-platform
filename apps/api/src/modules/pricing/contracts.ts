import type { Channel, PriceType } from '@commerce-platform/database';

/**
 * Public module contract of the Pricing context
 * (docs/architecture/60-module-contracts.md "Pricing").
 *
 * Other bounded contexts consume these queries through the
 * {@link PRICING_CONTRACTS} injection token — never through this
 * module's repositories or tables. The contract is read-only and every query
 * is organizationId-scoped (Layer 2 tenant isolation).
 */

/** Nest injection token binding the Pricing context's contract provider. */
export const PRICING_CONTRACTS = Symbol('PRICING_CONTRACTS');

/** Price quote result view exposed to other contexts. */
export interface PriceQuoteView {
  readonly amount: string;
  readonly priceType: PriceType;
  readonly channel: Channel;
  readonly source: 'BRANCH' | 'ORGANIZATIONAL';
}

/** Coupon validation result view exposed to other contexts. */
export interface CouponView {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly type: string;
  readonly value: string;
  readonly promotionId: string;
  readonly maxUses: number | null;
  readonly usedCount: number;
  readonly minOrderAmount: string | null;
  readonly isActive: boolean;
  readonly isValid: boolean;
}

/** Promotion evaluation result view exposed to other contexts. */
export interface PromotionView {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly type: string;
  readonly target: string;
  readonly value: string;
  readonly minQuantity: number | null;
  readonly maxQuantity: number | null;
  readonly isActive: boolean;
  readonly isValidAtDate: boolean;
}

/** Tax pricing result view exposed to other contexts. */
export interface TaxPricingResult {
  readonly baseAmount: string;
  readonly discountAmount: string;
  readonly taxAmount: string;
  readonly totalAmount: string;
}

/**
 * Queries provided by the Pricing bounded context.
 */
export interface PricingContracts {
  /** Resolve the best applicable price for a variant. */
  getPriceQuote(
    organizationId: string,
    input: {
      variantId: string;
      unitId: string;
      priceType: PriceType;
      channel: Channel;
      branchId?: string;
      effectiveDate?: string;
    },
  ): Promise<PriceQuoteView>;

  /** Validate a coupon code and return its current state. */
  validateCoupon(organizationId: string, code: string): Promise<CouponView>;

  /** Evaluate a promotion and return its current state. */
  evaluatePromotion(organizationId: string, promotionId: string): Promise<PromotionView>;

  /**
   * Calculate pricing including discounts and tax.
   * Placeholder for future tax engine integration.
   */
  calculateTaxPricingResult(
    organizationId: string,
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
  ): Promise<TaxPricingResult>;
}

export type { Channel as PricingChannel, PriceType as PricingPriceType };
