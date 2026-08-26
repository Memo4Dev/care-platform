import {
  boolean,
  date,
  decimal,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organization';
import { productVariants } from './catalog';
import { idColumn, optimisticVersion, timestamps } from './shared';

/**
 * Pricing bounded context (docs/architecture/13-pricing.md).
 *
 * Logical schema `pricing`:
 * price_books / price_entries / promotions / coupons / price_snapshots.
 *
 * Conventions:
 * - Every tenant-owned row carries `organization_id`.
 * - Business uniqueness is UNIQUE (organization_id, business_key).
 * - Composite tenant FKs anchor child rows to the owning organization.
 * - Price dimensions: Organization + Branch + Variant + Unit + PriceType
 *   + Channel + EffectiveDate.
 * - Completed Order/Sale stores a price snapshot.
 */
export const pricingSchema = pgSchema('pricing');

/* -------------------------------------------------------------------------- */
/* Price Types                                                                */
/* -------------------------------------------------------------------------- */

export const PRICE_TYPES = ['CASH', 'WHOLESALE', 'CREDIT', 'ONLINE'] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export const priceTypeEnum = pricingSchema.enum('price_type', PRICE_TYPES);

/* -------------------------------------------------------------------------- */
/* Channels                                                                   */
/* -------------------------------------------------------------------------- */

export const CHANNELS = ['POS', 'ONLINE', 'MOBILE', 'WHOLESALE'] as const;
export type Channel = (typeof CHANNELS)[number];

export const channelEnum = pricingSchema.enum('channel', CHANNELS);

/* -------------------------------------------------------------------------- */
/* Price Books                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A price book groups a set of pricing entries under one name/purpose.
 *
 * Each organization has one or more price books (e.g. "Default", "VIP",
 * "Seasonal"). One price book is marked as the organization's default.
 */
export const priceBooks = pricingSchema.table(
  'price_books',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('price_books_org_name_unique').on(table.organizationId, table.name),
    index('price_books_organization_id_idx').on(table.organizationId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Price Entries                                                              */
/* -------------------------------------------------------------------------- */

/**
 * A single price entry within a price book.
 *
 * Dimensions: variant + unit + priceType + channel + branch (optional).
 * Effective date range defines when this price is active.
 *
 * `branchId` is NULL for org-wide prices; set for branch-specific pricing.
 */
export const priceEntries = pricingSchema.table(
  'price_entries',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    priceBookId: uuid('price_book_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    priceType: priceTypeEnum('price_type').notNull(),
    channel: channelEnum('channel').notNull().default('POS'),
    branchId: uuid('branch_id'),
    amount: decimal('amount', { precision: 18, scale: 4 }).notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    // One price per (priceBook, variant, unit, priceType, channel, branch, effectiveFrom)
    unique('price_entries_book_variant_unit_type_channel_branch_effunique').on(
      table.priceBookId,
      table.variantId,
      table.unitId,
      table.priceType,
      table.channel,
      table.branchId,
      table.effectiveFrom,
    ),
    index('price_entries_organization_id_idx').on(table.organizationId),
    index('price_entries_price_book_id_idx').on(table.priceBookId),
    index('price_entries_variant_id_idx').on(table.variantId),
    index('price_entries_lookup_idx').on(
      table.priceBookId,
      table.variantId,
      table.unitId,
      table.priceType,
      table.channel,
      table.effectiveFrom,
    ),
    foreignKey({
      name: 'price_entries_price_book_tenant_fk',
      columns: [table.priceBookId, table.organizationId],
      foreignColumns: [priceBooks.id, priceBooks.organizationId],
    }),
    foreignKey({
      name: 'price_entries_variant_tenant_fk',
      columns: [table.variantId, table.organizationId],
      foreignColumns: [productVariants.id, productVariants.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Promotions                                                                 */
/* -------------------------------------------------------------------------- */

export const PROMOTION_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT', 'BUY_X_GET_Y'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export const promotionTypeEnum = pricingSchema.enum('promotion_type', PROMOTION_TYPES);

export const PROMOTION_TARGETS = ['PRODUCT', 'VARIANT', 'CATEGORY', 'ORDER'] as const;
export type PromotionTarget = (typeof PROMOTION_TARGETS)[number];

export const promotionTargetEnum = pricingSchema.enum('promotion_target', PROMOTION_TARGETS);

/**
 * A promotion that can be applied to products or orders.
 *
 * Target determines scope (PRODUCT/VARIANT/CATEGORY = line-level,
 * ORDER = entire order). Value carries the discount percentage or
 * fixed amount depending on type.
 */
export const promotions = pricingSchema.table(
  'promotions',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    type: promotionTypeEnum('type').notNull(),
    target: promotionTargetEnum('target').notNull(),
    value: decimal('value', { precision: 18, scale: 4 }).notNull(),
    minQuantity: integer('min_quantity'),
    maxQuantity: integer('max_quantity'),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('promotions_org_name_unique').on(table.organizationId, table.name),
    index('promotions_organization_id_idx').on(table.organizationId),
    index('promotions_active_dates_idx').on(
      table.organizationId,
      table.isActive,
      table.startDate,
      table.endDate,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* Coupons                                                                    */
/* -------------------------------------------------------------------------- */

export const COUPON_TYPES = ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export const couponTypeEnum = pricingSchema.enum('coupon_type', COUPON_TYPES);

/**
 * A redeemable coupon code within one organization.
 *
 * Each coupon has a code (unique within org), usage limits, and
 * optionally a linked promotion. Single-use or multi-use is controlled
 * by `maxUses` (null = unlimited within date window).
 */
export const coupons = pricingSchema.table(
  'coupons',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    description: text('description'),
    type: couponTypeEnum('type').notNull(),
    value: decimal('value', { precision: 18, scale: 4 }).notNull(),
    promotionId: uuid('promotion_id'),
    maxUses: integer('max_uses'),
    usedCount: integer('used_count').notNull().default(0),
    minOrderAmount: decimal('min_order_amount', { precision: 18, scale: 4 }),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('coupons_org_code_unique').on(table.organizationId, table.code),
    index('coupons_organization_id_idx').on(table.organizationId),
    index('coupons_active_code_idx').on(table.organizationId, table.isActive, table.code),
    foreignKey({
      name: 'coupons_promotion_tenant_fk',
      columns: [table.promotionId, table.organizationId],
      foreignColumns: [promotions.id, promotions.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Price Snapshots                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Immutable price snapshot captured at order/sale completion time.
 *
 * Once an order or sale is finalized, the price used must be captured
 * here so historical reports, returns and invoices reflect the actual
 * price at the time of transaction, not the current catalog price.
 */
export const priceSnapshots = pricingSchema.table(
  'price_snapshots',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sourceType: text('source_type').notNull(), // 'ORDER' | 'SALE'
    sourceId: uuid('source_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    priceType: priceTypeEnum('price_type').notNull(),
    channel: channelEnum('channel').notNull().default('POS'),
    branchId: uuid('branch_id'),
    amount: decimal('amount', { precision: 18, scale: 4 }).notNull(),
    quantity: decimal('quantity', { precision: 18, scale: 8 }).notNull(),
    discountAmount: decimal('discount_amount', { precision: 18, scale: 4 }).default('0'),
    promotionId: uuid('promotion_id'),
    couponId: uuid('coupon_id'),
    snapshotJson: jsonb('snapshot_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('price_snapshots_organization_id_idx').on(table.organizationId),
    index('price_snapshots_source_idx').on(table.sourceType, table.sourceId),
    index('price_snapshots_variant_idx').on(table.variantId),
  ],
);
