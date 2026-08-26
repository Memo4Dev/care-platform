import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import {
  coupons,
  integrationOutbox,
  newId,
  priceBooks,
  priceEntries,
  promotions,
  type Channel,
  type PriceType,
} from '@commerce-platform/database';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';

import { PriceBook } from '../domain/price-book';
import { PriceEntry } from '../domain/price-entry';
import { Promotion } from '../domain/promotion';
import { Coupon } from '../domain/coupon';
import { PRICING_AGGREGATE_TYPE, type PricingDomainEvent } from '../domain/events';
import type { PriceEntryRecord } from '../domain/quote';
import type { DbExecutor } from './db-executor';
import { pricingEventEnvelope } from './event-envelope';

// ---------------------------------------------------------------------------
// Helpers: Drizzle `date()` returns string | null, domain uses Date | null
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
 * Repository for the Pricing aggregates (Layer 2 of
 * docs/architecture/71-multi-tenant-isolation.md).
 *
 * - Every method takes an explicit {@link DbExecutor} so the application
 *   service controls the transaction boundary.
 * - Every tenant-owned access is `organizationId`-scoped.
 * - Save methods accept pre-collected domain events and persist them to the
 *   integration outbox atomically within the caller's transaction.
 */
export class PricingRepository {
  // ---------------------------------------------------------------------------
  // Price Book queries
  // ---------------------------------------------------------------------------

  async findPriceBook(
    executor: DbExecutor,
    organizationId: string,
    priceBookId: string,
  ): Promise<PriceBook | null> {
    const [row] = await executor
      .select()
      .from(priceBooks)
      .where(and(eq(priceBooks.id, priceBookId), eq(priceBooks.organizationId, organizationId)))
      .limit(1);

    if (!row) return null;

    return PriceBook.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      description: row.description ?? '',
      isDefault: row.isDefault,
      isActive: row.isActive,
      version: row.version,
    });
  }

  async findDefaultPriceBook(
    executor: DbExecutor,
    organizationId: string,
  ): Promise<PriceBook | null> {
    const [row] = await executor
      .select()
      .from(priceBooks)
      .where(and(eq(priceBooks.organizationId, organizationId), eq(priceBooks.isDefault, true)))
      .limit(1);

    if (!row) return null;

    return PriceBook.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      description: row.description ?? '',
      isDefault: row.isDefault,
      isActive: row.isActive,
      version: row.version,
    });
  }

  async findAllPriceBooks(executor: DbExecutor, organizationId: string): Promise<PriceBook[]> {
    const rows = await executor
      .select()
      .from(priceBooks)
      .where(eq(priceBooks.organizationId, organizationId))
      .orderBy(asc(priceBooks.createdAt));

    return rows.map((row) =>
      PriceBook.reconstitute({
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        description: row.description ?? '',
        isDefault: row.isDefault,
        isActive: row.isActive,
        version: row.version,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Price Entry queries
  // ---------------------------------------------------------------------------

  async findPriceEntry(
    executor: DbExecutor,
    organizationId: string,
    entryId: string,
  ): Promise<PriceEntry | null> {
    const [row] = await executor
      .select()
      .from(priceEntries)
      .where(and(eq(priceEntries.id, entryId), eq(priceEntries.organizationId, organizationId)))
      .limit(1);

    if (!row) return null;

    return PriceEntry.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      priceBookId: row.priceBookId,
      variantId: row.variantId,
      unitId: row.unitId,
      priceType: row.priceType as PriceType,
      channel: row.channel as Channel,
      branchId: row.branchId,
      amount: row.amount,
      effectiveFrom: toDateOrNull(row.effectiveFrom),
      effectiveTo: toDateOrNull(row.effectiveTo),
      version: row.version,
    });
  }

  async findPriceEntriesForLookup(
    executor: DbExecutor,
    organizationId: string,
    priceBookId: string,
    variantId: string,
    unitId: string,
    priceType: PriceType,
    channel: Channel,
    effectiveDate: Date,
  ): Promise<PriceEntryRecord[]> {
    const dateStr = toDateString(effectiveDate);
    const rows = await executor
      .select()
      .from(priceEntries)
      .where(
        and(
          eq(priceEntries.organizationId, organizationId),
          eq(priceEntries.priceBookId, priceBookId),
          eq(priceEntries.variantId, variantId),
          eq(priceEntries.unitId, unitId),
          eq(priceEntries.priceType, priceType),
          eq(priceEntries.channel, channel),
          sql`${priceEntries.effectiveFrom} <= ${dateStr}`,
          or(isNull(priceEntries.effectiveTo), sql`${priceEntries.effectiveTo} > ${dateStr}`),
        ),
      )
      .orderBy(asc(priceEntries.effectiveFrom));

    return rows.map((row) => ({
      variantId: row.variantId,
      unitId: row.unitId,
      priceType: row.priceType as PriceType,
      channel: row.channel as Channel,
      branchId: row.branchId,
      amount: row.amount,
      effectiveFrom: toDateOrNull(row.effectiveFrom),
      effectiveTo: toDateOrNull(row.effectiveTo),
    }));
  }

  async findActivePriceEntries(
    executor: DbExecutor,
    organizationId: string,
    variantId: string,
    effectiveDate: Date,
  ): Promise<PriceEntryRecord[]> {
    const dateStr = toDateString(effectiveDate);
    const rows = await executor
      .select()
      .from(priceEntries)
      .where(
        and(
          eq(priceEntries.organizationId, organizationId),
          eq(priceEntries.variantId, variantId),
          or(isNull(priceEntries.effectiveTo), sql`${priceEntries.effectiveFrom} <= ${dateStr}`),
          or(isNull(priceEntries.effectiveFrom), sql`${priceEntries.effectiveFrom} >= ${dateStr}`),
        ),
      )
      .orderBy(asc(priceEntries.effectiveFrom));

    return rows.map((row) => ({
      variantId: row.variantId,
      unitId: row.unitId,
      priceType: row.priceType as PriceType,
      channel: row.channel as Channel,
      branchId: row.branchId,
      amount: row.amount,
      effectiveFrom: toDateOrNull(row.effectiveFrom),
      effectiveTo: toDateOrNull(row.effectiveTo),
    }));
  }

  // ---------------------------------------------------------------------------
  // Promotion queries
  // ---------------------------------------------------------------------------

  async findPromotion(
    executor: DbExecutor,
    organizationId: string,
    promotionId: string,
  ): Promise<Promotion | null> {
    const [row] = await executor
      .select()
      .from(promotions)
      .where(and(eq(promotions.id, promotionId), eq(promotions.organizationId, organizationId)))
      .limit(1);

    if (!row) return null;

    return Promotion.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      type: row.type as Promotion['type'],
      target: row.target as Promotion['target'],
      value: row.value,
      minQuantity: row.minQuantity,
      maxQuantity: row.maxQuantity,
      startDate: toDateOrNull(row.startDate),
      endDate: toDateOrNull(row.endDate),
      isActive: row.isActive,
      version: row.version,
    });
  }

  async findActivePromotions(
    executor: DbExecutor,
    organizationId: string,
    effectiveDate: Date,
  ): Promise<Promotion[]> {
    const dateStr = toDateString(effectiveDate);
    const rows = await executor
      .select()
      .from(promotions)
      .where(
        and(
          eq(promotions.organizationId, organizationId),
          eq(promotions.isActive, true),
          or(isNull(promotions.endDate), sql`${promotions.endDate} >= ${dateStr}`),
        ),
      )
      .orderBy(asc(promotions.startDate));

    return rows.map((row) =>
      Promotion.reconstitute({
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        type: row.type as Promotion['type'],
        target: row.target as Promotion['target'],
        value: row.value,
        minQuantity: row.minQuantity,
        maxQuantity: row.maxQuantity,
        startDate: toDateOrNull(row.startDate),
        endDate: toDateOrNull(row.endDate),
        isActive: row.isActive,
        version: row.version,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Coupon queries
  // ---------------------------------------------------------------------------

  async findCoupon(
    executor: DbExecutor,
    organizationId: string,
    couponId: string,
  ): Promise<Coupon | null> {
    const [row] = await executor
      .select()
      .from(coupons)
      .where(and(eq(coupons.id, couponId), eq(coupons.organizationId, organizationId)))
      .limit(1);

    if (!row) return null;

    return mapCoupon(row);
  }

  async findByCode(
    executor: DbExecutor,
    organizationId: string,
    code: string,
  ): Promise<Coupon | null> {
    const [row] = await executor
      .select()
      .from(coupons)
      .where(and(eq(coupons.organizationId, organizationId), eq(coupons.code, code.toUpperCase())))
      .limit(1);

    if (!row) return null;

    return mapCoupon(row);
  }

  // ---------------------------------------------------------------------------
  // Save methods
  // ---------------------------------------------------------------------------

  async savePriceBook(
    executor: DbExecutor,
    aggregate: PriceBook,
    events: PricingDomainEvent[],
    options: { correlationId?: string } = {},
  ): Promise<number> {
    if (aggregate.hasPendingChanges) {
      if (aggregate.expectedVersion === 0) {
        await this.insertPriceBook(executor, aggregate);
      } else {
        await this.updatePriceBookGuarded(executor, aggregate);
      }
    }

    if (events.length > 0) {
      await this.persistEvents(
        executor,
        events,
        aggregate.id,
        aggregate.version,
        options.correlationId,
      );
    }

    aggregate.markPersisted();
    return events.length;
  }

  async savePriceEntry(
    executor: DbExecutor,
    aggregate: PriceEntry,
    events: PricingDomainEvent[],
    options: { correlationId?: string } = {},
  ): Promise<number> {
    if (aggregate.hasPendingChanges) {
      if (aggregate.expectedVersion === 0) {
        await this.insertPriceEntry(executor, aggregate);
      } else {
        await this.updatePriceEntryGuarded(executor, aggregate);
      }
    }

    if (events.length > 0) {
      await this.persistEvents(
        executor,
        events,
        aggregate.id,
        aggregate.version,
        options.correlationId,
      );
    }

    aggregate.markPersisted();
    return events.length;
  }

  async savePromotion(
    executor: DbExecutor,
    aggregate: Promotion,
    events: PricingDomainEvent[],
    options: { correlationId?: string } = {},
  ): Promise<number> {
    if (aggregate.hasPendingChanges) {
      if (aggregate.expectedVersion === 0) {
        await this.insertPromotion(executor, aggregate);
      } else {
        await this.updatePromotionGuarded(executor, aggregate);
      }
    }

    if (events.length > 0) {
      await this.persistEvents(
        executor,
        events,
        aggregate.id,
        aggregate.version,
        options.correlationId,
      );
    }

    aggregate.markPersisted();
    return events.length;
  }

  async saveCoupon(
    executor: DbExecutor,
    aggregate: Coupon,
    events: PricingDomainEvent[],
    options: { correlationId?: string } = {},
  ): Promise<number> {
    if (aggregate.hasPendingChanges) {
      if (aggregate.expectedVersion === 0) {
        await this.insertCoupon(executor, aggregate);
      } else {
        await this.updateCouponGuarded(executor, aggregate);
      }
    }

    if (events.length > 0) {
      await this.persistEvents(
        executor,
        events,
        aggregate.id,
        aggregate.version,
        options.correlationId,
      );
    }

    aggregate.markPersisted();
    return events.length;
  }

  // ---------------------------------------------------------------------------
  // Default price book coordination
  // ---------------------------------------------------------------------------

  /**
   * Clear all default flags for the organization and set the new default.
   * This is a direct SQL update that bypasses the aggregate pattern because
   * it operates across multiple price book rows atomically.
   */
  async updateDefaultPriceBooks(
    executor: DbExecutor,
    organizationId: string,
    newDefaultId: string,
  ): Promise<void> {
    // Clear all defaults
    await executor
      .update(priceBooks)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(priceBooks.organizationId, organizationId), eq(priceBooks.isDefault, true)));

    // Set the new default
    await executor
      .update(priceBooks)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(and(eq(priceBooks.id, newDefaultId), eq(priceBooks.organizationId, organizationId)));
  }

  // ---------------------------------------------------------------------------
  // Private: insert/update helpers
  // ---------------------------------------------------------------------------

  private async insertPriceBook(executor: DbExecutor, aggregate: PriceBook): Promise<void> {
    try {
      await executor.insert(priceBooks).values({
        id: aggregate.id,
        organizationId: aggregate.organizationId,
        name: aggregate.name,
        description: aggregate.description || null,
        isDefault: aggregate.isDefault,
        isActive: aggregate.isActive,
        version: aggregate.version,
      });
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'insert',
        table: 'pricing.price_books',
        organizationId: aggregate.organizationId,
        resourceId: aggregate.id,
      });
    }
  }

  private async updatePriceBookGuarded(executor: DbExecutor, aggregate: PriceBook): Promise<void> {
    let updated: Array<{ id: string }>;
    try {
      updated = await executor
        .update(priceBooks)
        .set({
          name: aggregate.name,
          description: aggregate.description || null,
          isDefault: aggregate.isDefault,
          isActive: aggregate.isActive,
          updatedAt: new Date(),
          version: aggregate.version,
        })
        .where(
          and(eq(priceBooks.id, aggregate.id), eq(priceBooks.version, aggregate.expectedVersion)),
        )
        .returning({ id: priceBooks.id });
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'update',
        table: 'pricing.price_books',
        organizationId: aggregate.organizationId,
        resourceId: aggregate.id,
      });
    }

    if (updated.length === 0) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `PriceBook ${aggregate.id} was modified concurrently ` +
          `(expected version ${aggregate.expectedVersion}).`,
        {
          details: {
            priceBookId: aggregate.id,
            expectedVersion: aggregate.expectedVersion,
          },
        },
      );
    }
  }

  private async insertPriceEntry(executor: DbExecutor, aggregate: PriceEntry): Promise<void> {
    try {
      await executor.insert(priceEntries).values({
        id: aggregate.id,
        organizationId: aggregate.organizationId,
        priceBookId: aggregate.priceBookId,
        variantId: aggregate.variantId,
        unitId: aggregate.unitId,
        priceType: aggregate.priceType,
        channel: aggregate.channel,
        amount: aggregate.amount,
        effectiveFrom: aggregate.effectiveFrom!.toISOString().slice(0, 10),
        version: aggregate.version,
        ...(aggregate.branchId !== null ? { branchId: aggregate.branchId } : {}),
        ...(aggregate.effectiveTo !== null
          ? { effectiveTo: aggregate.effectiveTo.toISOString().slice(0, 10) }
          : {}),
      });
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'insert',
        table: 'pricing.price_entries',
        organizationId: aggregate.organizationId,
        resourceId: aggregate.id,
      });
    }
  }

  private async updatePriceEntryGuarded(
    executor: DbExecutor,
    aggregate: PriceEntry,
  ): Promise<void> {
    let updated: Array<{ id: string }>;
    try {
      updated = await executor
        .update(priceEntries)
        .set({
          amount: aggregate.amount,
          updatedAt: new Date(),
          version: aggregate.version,
        })
        .where(
          and(
            eq(priceEntries.id, aggregate.id),
            eq(priceEntries.version, aggregate.expectedVersion),
          ),
        )
        .returning({ id: priceEntries.id });
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'update',
        table: 'pricing.price_entries',
        organizationId: aggregate.organizationId,
        resourceId: aggregate.id,
      });
    }

    if (updated.length === 0) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `PriceEntry ${aggregate.id} was modified concurrently ` +
          `(expected version ${aggregate.expectedVersion}).`,
        {
          details: {
            priceEntryId: aggregate.id,
            expectedVersion: aggregate.expectedVersion,
          },
        },
      );
    }
  }

  private async insertPromotion(executor: DbExecutor, aggregate: Promotion): Promise<void> {
    try {
      await executor.insert(promotions).values({
        id: aggregate.id,
        organizationId: aggregate.organizationId,
        name: aggregate.name,
        type: aggregate.type,
        target: aggregate.target,
        value: aggregate.value,
        startDate: aggregate.startDate
          ? aggregate.startDate.toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
        endDate: aggregate.endDate ? aggregate.endDate.toISOString().slice(0, 10) : '2099-12-31',
        isActive: aggregate.isActive,
        version: aggregate.version,
        ...(aggregate.minQuantity !== null ? { minQuantity: aggregate.minQuantity } : {}),
        ...(aggregate.maxQuantity !== null ? { maxQuantity: aggregate.maxQuantity } : {}),
      });
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'insert',
        table: 'pricing.promotions',
        organizationId: aggregate.organizationId,
        resourceId: aggregate.id,
      });
    }
  }

  private async updatePromotionGuarded(executor: DbExecutor, aggregate: Promotion): Promise<void> {
    let updated: Array<{ id: string }>;
    try {
      updated = await executor
        .update(promotions)
        .set({
          isActive: aggregate.isActive,
          updatedAt: new Date(),
          version: aggregate.version,
        })
        .where(
          and(eq(promotions.id, aggregate.id), eq(promotions.version, aggregate.expectedVersion)),
        )
        .returning({ id: promotions.id });
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'update',
        table: 'pricing.promotions',
        organizationId: aggregate.organizationId,
        resourceId: aggregate.id,
      });
    }

    if (updated.length === 0) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `Promotion ${aggregate.id} was modified concurrently ` +
          `(expected version ${aggregate.expectedVersion}).`,
        {
          details: {
            promotionId: aggregate.id,
            expectedVersion: aggregate.expectedVersion,
          },
        },
      );
    }
  }

  private async insertCoupon(executor: DbExecutor, aggregate: Coupon): Promise<void> {
    try {
      await executor.insert(coupons).values({
        id: aggregate.id,
        organizationId: aggregate.organizationId,
        code: aggregate.code,
        type: aggregate.type as 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING',
        value: aggregate.value,
        startDate: aggregate.startDate
          ? aggregate.startDate.toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10),
        endDate: aggregate.endDate ? aggregate.endDate.toISOString().slice(0, 10) : '2099-12-31',
        isActive: aggregate.isActive,
        version: aggregate.version,
        ...(aggregate.promotionId ? { promotionId: aggregate.promotionId } : {}),
        ...(aggregate.maxUses !== null ? { maxUses: aggregate.maxUses } : {}),
        ...(aggregate.minOrderAmount !== null ? { minOrderAmount: aggregate.minOrderAmount } : {}),
      });
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'insert',
        table: 'pricing.coupons',
        organizationId: aggregate.organizationId,
        resourceId: aggregate.id,
      });
    }
  }

  private async updateCouponGuarded(executor: DbExecutor, aggregate: Coupon): Promise<void> {
    let updated: Array<{ id: string }>;
    try {
      updated = await executor
        .update(coupons)
        .set({
          usedCount: aggregate.usedCount,
          isActive: aggregate.isActive,
          updatedAt: new Date(),
          version: aggregate.version,
        })
        .where(and(eq(coupons.id, aggregate.id), eq(coupons.version, aggregate.expectedVersion)))
        .returning({ id: coupons.id });
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'update',
        table: 'pricing.coupons',
        organizationId: aggregate.organizationId,
        resourceId: aggregate.id,
      });
    }

    if (updated.length === 0) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `Coupon ${aggregate.id} was modified concurrently ` +
          `(expected version ${aggregate.expectedVersion}).`,
        {
          details: {
            couponId: aggregate.id,
            expectedVersion: aggregate.expectedVersion,
          },
        },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private: event persistence
  // ---------------------------------------------------------------------------

  private async persistEvents(
    executor: DbExecutor,
    events: PricingDomainEvent[],
    aggregateId: string,
    aggregateVersion: number,
    correlationId?: string,
  ): Promise<void> {
    await executor.insert(integrationOutbox).values(
      events.map((event) => ({
        id: newId(),
        aggregateType: PRICING_AGGREGATE_TYPE,
        aggregateId,
        eventType: `pricing.${event.type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
        payload: pricingEventEnvelope({
          event,
          aggregateId,
          aggregateVersion,
          correlationId: correlationId ?? 'SYSTEM',
        }),
        correlationId: correlationId ?? null,
        occurredAt: event.occurredAt,
      })),
    );
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapCoupon(row: {
  id: string;
  organizationId: string;
  code: string;
  type: string;
  value: string;
  promotionId: string | null;
  maxUses: number | null;
  usedCount: number;
  minOrderAmount: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  version: number;
}): Coupon {
  return Coupon.reconstitute({
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    type: row.type,
    value: row.value,
    promotionId: row.promotionId ?? '',
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    minOrderAmount: row.minOrderAmount,
    startDate: toDateOrNull(row.startDate),
    endDate: toDateOrNull(row.endDate),
    isActive: row.isActive,
    version: row.version,
  });
}

// ---------------------------------------------------------------------------
// Persistence error mapping
// ---------------------------------------------------------------------------

interface PersistenceErrorContext {
  action: 'insert' | 'update';
  table: string;
  organizationId: string;
  resourceId?: string;
}

interface PgLikeError {
  code?: unknown;
  constraint?: unknown;
  detail?: unknown;
}

/**
 * Maps storage-level violations onto the platform error catalog:
 *
 * - unique_violation on business keys -> VALIDATION_FAILED (422): well-formed
 *   content violating business rules; the constraint name is preserved in
 *   `details` for support tooling.
 * - everything else is returned untouched: unexpected driver failures must
 *   not be disguised as domain errors.
 */
export function mapPersistenceError(error: unknown, context: PersistenceErrorContext): unknown {
  const candidate = error as PgLikeError | null;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    candidate.code !== '23505' ||
    typeof candidate.constraint !== 'string'
  ) {
    return error;
  }

  const fieldByConstraint: Record<string, string> = {
    price_books_org_name_unique: 'name',
    price_entries_book_variant_unit_type_channel_branch_effunique: 'variantId',
    promotions_org_name_unique: 'name',
    coupons_org_code_unique: 'code',
  };

  const field = fieldByConstraint[candidate.constraint] ?? 'constraint';
  return PlatformError.validationFailed(
    `${context.table} constraint ${candidate.constraint} violated during ${context.action}.`,
    {
      details: {
        constraint: candidate.constraint,
        field,
        table: context.table,
        organizationId: context.organizationId,
        ...(context.resourceId === undefined ? {} : { resourceId: context.resourceId }),
      },
      cause: error,
    },
  );
}
