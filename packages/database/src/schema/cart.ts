import {
  check,
  decimal,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { productVariants, unitDefinitions } from './catalog';
import { branches, organizations, warehouses } from './organization';
import { idColumn, optimisticVersion, timestamps } from './shared';

/** Persisted editable-cart state owned by the Cart bounded context. */
export const cartSchema = pgSchema('cart');

export const CART_CHANNELS = ['ONLINE', 'POS', 'SALES'] as const;
export type CartChannel = (typeof CART_CHANNELS)[number];

/** M5-004 persisted Draft carts first; later terminal states remain additive. */
export const CART_STATUSES = ['DRAFT', 'CHECKED_OUT'] as const;
export type CartStatus = (typeof CART_STATUSES)[number];

export const CART_HOLD_STATUSES = [
  'PENDING',
  'ACTIVE',
  'RELEASING',
  'RELEASED',
  'EXPIRED',
  'FAILED',
  'CHECKED_OUT',
] as const;
export type CartHoldStatus = (typeof CART_HOLD_STATUSES)[number];

export type CartHoldShortage = Record<string, unknown>;
export type CartHoldFailure = Record<string, unknown>;

export const carts = cartSchema.table(
  'carts',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    channel: text('channel').$type<CartChannel>().notNull().default('POS'),
    status: text('status').$type<CartStatus>().notNull().default('DRAFT'),
    /** A reference only; Customer persistence remains owned by Customers. */
    customerId: uuid('customer_id'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    check('carts_channel_check', sql`${table.channel} IN ('ONLINE', 'POS', 'SALES')`),
    check('carts_status_check', sql`${table.status} IN ('DRAFT', 'CHECKED_OUT')`),
    unique('carts_tenant_scope_unique').on(table.id, table.organizationId),
    unique('carts_tenant_branch_scope_unique').on(table.id, table.organizationId, table.branchId),
    index('carts_organization_id_idx').on(table.organizationId),
    index('carts_org_branch_created_at_idx').on(
      table.organizationId,
      table.branchId,
      table.createdAt,
    ),
    index('carts_org_status_idx').on(table.organizationId, table.status),
    foreignKey({
      name: 'carts_branch_tenant_fk',
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete('cascade'),
  ],
);

/**
 * Durable, Cart-owned hold workflow state. Inventory reservation identity is a
 * plain cross-context reference: Cart never owns or foreign-keys Inventory
 * persistence.
 */
export const cartHolds = cartSchema.table(
  'cart_holds',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    cartId: uuid('cart_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    cartVersion: integer('cart_version').notNull(),
    status: text('status').$type<CartHoldStatus>().notNull().default('PENDING'),
    ttlMinutes: integer('ttl_minutes').notNull(),
    policyVersion: integer('policy_version').notNull(),
    /** Cross-context reference only; deliberately no Inventory FK. */
    inventoryReservationId: uuid('inventory_reservation_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    shortagesJson: jsonb('shortages_json').$type<CartHoldShortage[]>(),
    failureJson: jsonb('failure_json').$type<CartHoldFailure>(),
    /** Trusted Organization user captured when the workflow was accepted. */
    actorId: uuid('actor_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    causationId: text('causation_id').notNull(),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    check('cart_holds_cart_version_positive_check', sql`${table.cartVersion} >= 1`),
    check(
      'cart_holds_status_check',
      sql`${table.status} IN ('PENDING', 'ACTIVE', 'RELEASING', 'RELEASED', 'EXPIRED', 'FAILED', 'CHECKED_OUT')`,
    ),
    check('cart_holds_ttl_minutes_check', sql`${table.ttlMinutes} BETWEEN 1 AND 1440`),
    check('cart_holds_policy_version_check', sql`${table.policyVersion} >= 0`),
    uniqueIndex('cart_holds_one_current_per_cart_unique')
      .on(table.organizationId, table.cartId)
      .where(sql`${table.status} IN ('PENDING', 'ACTIVE', 'RELEASING')`),
    index('cart_holds_org_cart_created_at_idx').on(
      table.organizationId,
      table.cartId,
      table.createdAt,
    ),
    index('cart_holds_current_workflow_idx')
      .on(table.organizationId, table.status, table.updatedAt)
      .where(sql`${table.status} IN ('PENDING', 'ACTIVE', 'RELEASING')`),
    index('cart_holds_warehouse_scope_idx').on(
      table.warehouseId,
      table.organizationId,
      table.branchId,
    ),
    foreignKey({
      name: 'cart_holds_cart_tenant_branch_fk',
      columns: [table.cartId, table.organizationId, table.branchId],
      foreignColumns: [carts.id, carts.organizationId, carts.branchId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'cart_holds_warehouse_tenant_branch_fk',
      columns: [table.warehouseId, table.organizationId, table.branchId],
      foreignColumns: [warehouses.id, warehouses.organizationId, warehouses.branchId],
    }),
  ],
);

export const cartItems = cartSchema.table(
  'cart_items',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    cartId: uuid('cart_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    unitId: uuid('unit_id').notNull(),
    /** Quantity uses the platform's eight-decimal quantity precision. */
    quantity: decimal('quantity', { precision: 14, scale: 8 }).notNull(),
    ...timestamps,
  },
  (table) => [
    check('cart_items_quantity_positive_check', sql`${table.quantity} > 0`),
    check('cart_items_quantity_finite_max_check', sql`${table.quantity} <= 999999.99999999`),
    unique('cart_items_org_cart_variant_unit_unique').on(
      table.organizationId,
      table.cartId,
      table.variantId,
      table.unitId,
    ),
    index('cart_items_organization_id_idx').on(table.organizationId),
    index('cart_items_cart_id_idx').on(table.cartId),
    index('cart_items_variant_id_idx').on(table.variantId),
    index('cart_items_unit_id_idx').on(table.unitId, table.organizationId),
    foreignKey({
      name: 'cart_items_cart_tenant_fk',
      columns: [table.cartId, table.organizationId],
      foreignColumns: [carts.id, carts.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'cart_items_variant_tenant_fk',
      columns: [table.variantId, table.organizationId],
      foreignColumns: [productVariants.id, productVariants.organizationId],
    }),
    foreignKey({
      name: 'cart_items_unit_tenant_fk',
      columns: [table.unitId, table.organizationId],
      foreignColumns: [unitDefinitions.id, unitDefinitions.organizationId],
    }),
  ],
);

export type CartRow = typeof carts.$inferSelect;
export type CartItemRow = typeof cartItems.$inferSelect;
export type CartHoldRow = typeof cartHolds.$inferSelect;
