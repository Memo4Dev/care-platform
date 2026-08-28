import {
  check,
  decimal,
  foreignKey,
  index,
  pgSchema,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { productVariants, unitDefinitions } from './catalog';
import { branches, organizations } from './organization';
import { idColumn, optimisticVersion, timestamps } from './shared';

/** Persisted editable-cart state owned by the Cart bounded context. */
export const cartSchema = pgSchema('cart');

export const CART_CHANNELS = ['ONLINE', 'POS', 'SALES'] as const;
export type CartChannel = (typeof CART_CHANNELS)[number];

/** M5-004 persists only editable Draft carts; later lifecycle states are additive. */
export const CART_STATUSES = ['DRAFT'] as const;
export type CartStatus = (typeof CART_STATUSES)[number];

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
    check('carts_status_check', sql`${table.status} = 'DRAFT'`),
    unique('carts_tenant_scope_unique').on(table.id, table.organizationId),
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
