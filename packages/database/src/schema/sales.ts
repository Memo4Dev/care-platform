import {
  check,
  decimal,
  foreignKey,
  bigint,
  index,
  pgSchema,
  text,
  unique,
  uniqueIndex,
  uuid,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { carts } from './cart';
import { products, productVariants, unitDefinitions } from './catalog';
import type { CustomerType } from './customers';
import { branches, organizations, warehouses } from './organization';
import { idColumn, optimisticVersion, optimisticVersionColumn, timestamps } from './shared';

export const salesSchema = pgSchema('sales');

export const SALE_STATUSES = ['PENDING_PAYMENT', 'COMPLETED', 'CANCELLED'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_PRICE_TYPES = ['CASH', 'WHOLESALE', 'CREDIT', 'ONLINE'] as const;
export type SalePriceType = (typeof SALE_PRICE_TYPES)[number];

export const SALE_PRICING_SOURCES = ['BRANCH', 'ORGANIZATIONAL'] as const;
export type SalePricingSource = (typeof SALE_PRICING_SOURCES)[number];

export const sales = salesSchema.table(
  'sales',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    warehouseId: uuid('warehouse_id'),
    cartId: uuid('cart_id').notNull(),
    cartVersion: optimisticVersionColumn('cart_version'),
    customerId: uuid('customer_id'),
    customerType: text('customer_type').$type<CustomerType>(),
    customerDisplayName: text('customer_display_name'),
    customerCode: text('customer_code'),
    operatorId: uuid('operator_id').notNull(),
    deviceId: uuid('device_id'),
    saleNumber: text('sale_number').notNull(),
    status: text('status').$type<SaleStatus>().notNull().default('PENDING_PAYMENT'),
    priceType: text('price_type').$type<SalePriceType>().notNull().default('CASH'),
    currency: text('currency').notNull(),
    subtotal: decimal('subtotal', { precision: 18, scale: 8 }).notNull(),
    discountTotal: decimal('discount_total', { precision: 18, scale: 8 }).notNull(),
    taxTotal: decimal('tax_total', { precision: 18, scale: 8 }).notNull(),
    total: decimal('total', { precision: 18, scale: 8 }).notNull(),
    inventoryReservationId: uuid('inventory_reservation_id'),
    inventoryAllocationId: uuid('inventory_allocation_id'),
    completionReferenceType: text('completion_reference_type'),
    completionReferenceId: text('completion_reference_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    cancelledBy: uuid('cancelled_by'),
    correlationId: text('correlation_id').notNull(),
    causationId: text('causation_id').notNull(),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    check(
      'sales_status_check',
      sql`${table.status} IN ('PENDING_PAYMENT', 'COMPLETED', 'CANCELLED')`,
    ),
    check(
      'sales_price_type_check',
      sql`${table.priceType} IN ('CASH', 'WHOLESALE', 'CREDIT', 'ONLINE')`,
    ),
    check('sales_cart_version_check', sql`${table.cartVersion} >= 1`),
    check('sales_subtotal_non_negative_check', sql`${table.subtotal} >= 0`),
    check('sales_discount_total_non_negative_check', sql`${table.discountTotal} >= 0`),
    check('sales_tax_total_non_negative_check', sql`${table.taxTotal} >= 0`),
    check('sales_total_non_negative_check', sql`${table.total} >= 0`),
    check(
      'sales_customer_type_check',
      sql`${table.customerType} IS NULL OR ${table.customerType} IN ('INDIVIDUAL', 'BUSINESS')`,
    ),
    unique('sales_tenant_scope_unique').on(table.id, table.organizationId),
    uniqueIndex('sales_org_sale_number_unique').on(table.organizationId, table.saleNumber),
    uniqueIndex('sales_one_sale_per_cart_unique').on(table.organizationId, table.cartId),
    uniqueIndex('sales_completion_reference_unique')
      .on(table.organizationId, table.completionReferenceType, table.completionReferenceId)
      .where(
        sql`${table.completionReferenceType} IS NOT NULL AND ${table.completionReferenceId} IS NOT NULL`,
      ),
    index('sales_org_branch_created_at_idx').on(table.organizationId, table.branchId, table.createdAt),
    index('sales_org_status_created_at_idx').on(table.organizationId, table.status, table.createdAt),
    index('sales_org_cart_idx').on(table.organizationId, table.cartId),
    index('sales_org_customer_idx').on(table.organizationId, table.customerId),
    foreignKey({
      name: 'sales_branch_tenant_fk',
      columns: [table.branchId, table.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'sales_warehouse_tenant_branch_fk',
      columns: [table.warehouseId, table.organizationId, table.branchId],
      foreignColumns: [warehouses.id, warehouses.organizationId, warehouses.branchId],
    }),
    foreignKey({
      name: 'sales_cart_tenant_fk',
      columns: [table.cartId, table.organizationId],
      foreignColumns: [carts.id, carts.organizationId],
    }),
  ],
);

export const saleItems = salesSchema.table(
  'sale_items',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    saleId: uuid('sale_id').notNull(),
    cartItemId: uuid('cart_item_id'),
    productId: uuid('product_id'),
    variantId: uuid('variant_id').notNull(),
    productName: text('product_name'),
    variantName: text('variant_name'),
    snapshotLabel: text('snapshot_label').notNull(),
    sku: text('sku'),
    barcode: text('barcode'),
    unitId: uuid('unit_id').notNull(),
    baseUnitId: uuid('base_unit_id'),
    quantity: decimal('quantity', { precision: 18, scale: 8 }).notNull(),
    baseQuantity: decimal('base_quantity', { precision: 18, scale: 8 }).notNull(),
    unitPrice: decimal('unit_price', { precision: 18, scale: 8 }).notNull(),
    lineSubtotal: decimal('line_subtotal', { precision: 18, scale: 8 }).notNull(),
    discountTotal: decimal('discount_total', { precision: 18, scale: 8 }).notNull(),
    taxTotal: decimal('tax_total', { precision: 18, scale: 8 }).notNull(),
    lineTotal: decimal('line_total', { precision: 18, scale: 8 }).notNull(),
    currency: text('currency').notNull(),
    priceType: text('price_type').$type<SalePriceType>().notNull(),
    pricingSource: text('pricing_source').$type<SalePricingSource>().notNull(),
    pricingReference: text('pricing_reference'),
    ...timestamps,
  },
  (table) => [
    check('sale_items_quantity_positive_check', sql`${table.quantity} > 0`),
    check('sale_items_base_quantity_positive_check', sql`${table.baseQuantity} > 0`),
    check('sale_items_unit_price_non_negative_check', sql`${table.unitPrice} >= 0`),
    check('sale_items_line_subtotal_non_negative_check', sql`${table.lineSubtotal} >= 0`),
    check('sale_items_discount_total_non_negative_check', sql`${table.discountTotal} >= 0`),
    check('sale_items_tax_total_non_negative_check', sql`${table.taxTotal} >= 0`),
    check('sale_items_line_total_non_negative_check', sql`${table.lineTotal} >= 0`),
    check(
      'sale_items_price_type_check',
      sql`${table.priceType} IN ('CASH', 'WHOLESALE', 'CREDIT', 'ONLINE')`,
    ),
    check(
      'sale_items_pricing_source_check',
      sql`${table.pricingSource} IN ('BRANCH', 'ORGANIZATIONAL')`,
    ),
    unique('sale_items_tenant_scope_unique').on(table.id, table.organizationId),
    uniqueIndex('sale_items_sale_cart_item_unique')
      .on(table.organizationId, table.saleId, table.cartItemId)
      .where(sql`${table.cartItemId} IS NOT NULL`),
    index('sale_items_org_sale_idx').on(table.organizationId, table.saleId),
    index('sale_items_org_variant_idx').on(table.organizationId, table.variantId),
    foreignKey({
      name: 'sale_items_sale_tenant_fk',
      columns: [table.saleId, table.organizationId],
      foreignColumns: [sales.id, sales.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'sale_items_product_tenant_fk',
      columns: [table.productId, table.organizationId],
      foreignColumns: [products.id, products.organizationId],
    }),
    foreignKey({
      name: 'sale_items_variant_tenant_fk',
      columns: [table.variantId, table.organizationId],
      foreignColumns: [productVariants.id, productVariants.organizationId],
    }),
    foreignKey({
      name: 'sale_items_unit_tenant_fk',
      columns: [table.unitId, table.organizationId],
      foreignColumns: [unitDefinitions.id, unitDefinitions.organizationId],
    }),
    foreignKey({
      name: 'sale_items_base_unit_tenant_fk',
      columns: [table.baseUnitId, table.organizationId],
      foreignColumns: [unitDefinitions.id, unitDefinitions.organizationId],
    }),
  ],
);

export const saleNumberCounters = salesSchema.table(
  'sale_number_counters',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
    ...timestamps,
  },
  (table) => [check('sale_number_counters_next_value_check', sql`${table.nextValue} >= 1`)],
);

export type SaleRow = typeof sales.$inferSelect;
export type SaleItemRow = typeof saleItems.$inferSelect;
