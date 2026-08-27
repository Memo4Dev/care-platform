import {
  boolean,
  decimal,
  foreignKey,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations, warehouses } from './organization';
import { productVariants } from './catalog';
import { idColumn, optimisticVersion, timestamps } from './shared';

/**
 * Purchasing bounded context (docs/architecture/16-purchasing.md).
 *
 * Logical schema `purchasing`:
 * suppliers / purchase_orders / purchase_order_items /
 * goods_receipts / goods_receipt_items / purchase_costs.
 *
 * Conventions:
 * - Every tenant-owned row carries `organization_id`.
 * - Business uniqueness is UNIQUE (organization_id, business_key).
 * - Composite tenant FKs anchor child rows to the owning organization.
 * - Quantities and costs are decimal(14,4), never float.
 * - Multiple POs for same Supplier + Variant are allowed (no uniqueness).
 * - GoodsReceipt is separate from PurchaseOrder.
 * - Only accepted received quantity enters Inventory.
 * - Confirmed GoodsReceipt is immutable (enforced at application layer).
 * - Optional costs (shipping/customs/handling/other) feed Actual Cost
 *   which feeds Inventory FIFO layers.
 */
export const purchasingSchema = pgSchema('purchasing');

/* -------------------------------------------------------------------------- */
/* Suppliers — External Vendor Identity                                        */
/* -------------------------------------------------------------------------- */

/**
 * External supplier/vendor within one organization.
 *
 * `code` is a business-level identifier (e.g. "SUP-001"), unique per org.
 * `is_active` enables soft-disable without deleting purchase history.
 */
export const suppliers = purchasingSchema.table(
  'suppliers',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    uniqueIndex('suppliers_org_code_unique').on(table.organizationId, table.code),
    // Tenant-scope unique for FK references from child tables (purchase_orders)
    uniqueIndex('suppliers_tenant_scope_unique').on(table.id, table.organizationId),
    index('suppliers_organization_id_idx').on(table.organizationId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Purchase Orders — Aggregate Identity                                        */
/* -------------------------------------------------------------------------- */

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/**
 * A purchase order from one organization to a supplier.
 *
 * Lifecycle:
 *   DRAFT → SUBMITTED → APPROVED → SENT → PARTIALLY_RECEIVED → RECEIVED
 *                    ↘ REJECTED   ↘ CANCELLED
 *
 * `warehouse_id` is the destination where goods will be received.
 * `version` supports optimistic concurrency on status transitions.
 */
export const purchaseOrders = purchasingSchema.table(
  'purchase_orders',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').notNull(),
    status: text('status').notNull().default('DRAFT'),
    warehouseId: uuid('warehouse_id').notNull(),
    orderDate: timestamp('order_date', { withTimezone: true }).notNull().defaultNow(),
    expectedDeliveryDate: timestamp('expected_delivery_date', { withTimezone: true }),
    notes: text('notes'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    // Tenant-scope unique for FK references from child tables (purchase_order_items, goods_receipts)
    uniqueIndex('purchase_orders_tenant_scope_unique').on(table.id, table.organizationId),
    index('purchase_orders_organization_id_idx').on(table.organizationId),
    index('purchase_orders_supplier_id_idx').on(table.supplierId),
    index('purchase_orders_warehouse_id_idx').on(table.warehouseId),
    index('purchase_orders_status_idx').on(table.status),
    index('purchase_orders_org_status_idx').on(table.organizationId, table.status),
    foreignKey({
      name: 'purchase_orders_supplier_tenant_fk',
      columns: [table.supplierId, table.organizationId],
      foreignColumns: [suppliers.id, suppliers.organizationId],
    }),
    foreignKey({
      name: 'purchase_orders_warehouse_tenant_fk',
      columns: [table.warehouseId, table.organizationId],
      foreignColumns: [warehouses.id, warehouses.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Purchase Order Items — Line Items                                           */
/* -------------------------------------------------------------------------- */

/**
 * Individual variant line item within a purchase order.
 *
 * `quantity` is the ordered quantity in the variant's base unit.
 * `received_quantity` accumulates as goods receipts are confirmed.
 * `unit_cost` is the supplier price per base unit.
 *
 * Optional packaging metadata:
 *   `packaging_unit` — e.g. "CARTON", "BOX", "PIECE"
 *   `packaging_quantity` — how many base units in one packaging unit
 *   `packaging_conversion` — conversion factor to base unit
 */
export const purchaseOrderItems = purchasingSchema.table(
  'purchase_order_items',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    quantity: decimal('quantity', { precision: 14, scale: 4 }).notNull(),
    receivedQuantity: decimal('received_quantity', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    unitCost: decimal('unit_cost', { precision: 14, scale: 4 }).notNull(),
    packagingUnit: text('packaging_unit'),
    packagingQuantity: decimal('packaging_quantity', { precision: 14, scale: 4 }),
    packagingConversion: decimal('packaging_conversion', { precision: 14, scale: 4 }),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [
    // Tenant-scope unique for FK references from child tables (goods_receipt_items)
    uniqueIndex('purchase_order_items_tenant_scope_unique').on(table.id, table.organizationId),
    index('purchase_order_items_organization_id_idx').on(table.organizationId),
    index('purchase_order_items_purchase_order_id_idx').on(table.purchaseOrderId),
    index('purchase_order_items_variant_id_idx').on(table.variantId),
    foreignKey({
      name: 'purchase_order_items_purchase_order_tenant_fk',
      columns: [table.purchaseOrderId, table.organizationId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.organizationId],
    }),
    foreignKey({
      name: 'purchase_order_items_variant_tenant_fk',
      columns: [table.variantId, table.organizationId],
      foreignColumns: [productVariants.id, productVariants.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Goods Receipts — Receiving Aggregate                                        */
/* -------------------------------------------------------------------------- */

export const GOODS_RECEIPT_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;
export type GoodsReceiptStatus = (typeof GOODS_RECEIPT_STATUSES)[number];

/**
 * A goods receipt record against a purchase order.
 *
 * Lifecycle: PENDING → CONFIRMED (or CANCELLED).
 * Once CONFIRMED, the receipt is immutable (enforced at application layer).
 *
 * Only `quantity_accepted` across all items enters Inventory as FIFO layers.
 * `confirmed_at` and `confirmed_by` capture the confirmation audit trail.
 * `version` supports optimistic concurrency on status transitions.
 */
export const goodsReceipts = purchasingSchema.table(
  'goods_receipts',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    status: text('status').notNull().default('PENDING'),
    receivedDate: timestamp('received_date', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    // Tenant-scope unique for FK references from child tables (goods_receipt_items, purchase_costs)
    uniqueIndex('goods_receipts_tenant_scope_unique').on(table.id, table.organizationId),
    index('goods_receipts_organization_id_idx').on(table.organizationId),
    index('goods_receipts_purchase_order_id_idx').on(table.purchaseOrderId),
    index('goods_receipts_warehouse_id_idx').on(table.warehouseId),
    index('goods_receipts_status_idx').on(table.status),
    index('goods_receipts_org_status_idx').on(table.organizationId, table.status),
    foreignKey({
      name: 'goods_receipts_purchase_order_tenant_fk',
      columns: [table.purchaseOrderId, table.organizationId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.organizationId],
    }),
    foreignKey({
      name: 'goods_receipts_warehouse_tenant_fk',
      columns: [table.warehouseId, table.organizationId],
      foreignColumns: [warehouses.id, warehouses.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Goods Receipt Items — Receiving Line Items                                  */
/* -------------------------------------------------------------------------- */

/**
 * Individual variant line item within a goods receipt.
 *
 * `quantity_received` — actual physical quantity received.
 * `quantity_accepted` — quantity accepted after inspection (feeds Inventory).
 * `quantity_rejected` — quantity rejected after inspection.
 * `unit_cost` — actual cost at receipt time (may differ from PO unit cost).
 *
 * `quantity_accepted <= quantity_received` and
 * `quantity_received = quantity_accepted + quantity_rejected`
 * are enforced at the application layer.
 */
export const goodsReceiptItems = purchasingSchema.table(
  'goods_receipt_items',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    goodsReceiptId: uuid('goods_receipt_id').notNull(),
    purchaseOrderItemId: uuid('purchase_order_item_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    quantityReceived: decimal('quantity_received', { precision: 14, scale: 4 }).notNull(),
    quantityAccepted: decimal('quantity_accepted', { precision: 14, scale: 4 }).notNull(),
    quantityRejected: decimal('quantity_rejected', { precision: 14, scale: 4 })
      .notNull()
      .default('0'),
    unitCost: decimal('unit_cost', { precision: 14, scale: 4 }).notNull(),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [
    index('goods_receipt_items_organization_id_idx').on(table.organizationId),
    index('goods_receipt_items_goods_receipt_id_idx').on(table.goodsReceiptId),
    index('goods_receipt_items_purchase_order_item_id_idx').on(table.purchaseOrderItemId),
    index('goods_receipt_items_variant_id_idx').on(table.variantId),
    foreignKey({
      name: 'goods_receipt_items_goods_receipt_tenant_fk',
      columns: [table.goodsReceiptId, table.organizationId],
      foreignColumns: [goodsReceipts.id, goodsReceipts.organizationId],
    }),
    foreignKey({
      name: 'goods_receipt_items_purchase_order_item_tenant_fk',
      columns: [table.purchaseOrderItemId, table.organizationId],
      foreignColumns: [purchaseOrderItems.id, purchaseOrderItems.organizationId],
    }),
    foreignKey({
      name: 'goods_receipt_items_variant_tenant_fk',
      columns: [table.variantId, table.organizationId],
      foreignColumns: [productVariants.id, productVariants.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Purchase Costs — Additional Costs Per Receipt                               */
/* -------------------------------------------------------------------------- */

export const PURCHASE_COST_TYPES = ['SHIPPING', 'CUSTOMS', 'HANDLING', 'OTHER'] as const;
export type PurchaseCostType = (typeof PURCHASE_COST_TYPES)[number];

/**
 * Additional cost associated with a goods receipt.
 *
 * These costs (shipping, customs, handling, other) feed the Actual Cost
 * calculation which in turn feeds Inventory FIFO layers.
 *
 * `amount` is in `currency` (default USD). Multiple cost rows per receipt
 * are allowed (e.g. separate shipping and customs charges).
 */
export const purchaseCosts = purchasingSchema.table(
  'purchase_costs',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    goodsReceiptId: uuid('goods_receipt_id').notNull(),
    costType: text('cost_type').notNull(),
    amount: decimal('amount', { precision: 14, scale: 4 }).notNull(),
    currency: text('currency').notNull().default('USD'),
    description: text('description'),
    ...timestamps,
  },
  (table) => [
    index('purchase_costs_organization_id_idx').on(table.organizationId),
    index('purchase_costs_goods_receipt_id_idx').on(table.goodsReceiptId),
    index('purchase_costs_cost_type_idx').on(table.costType),
    foreignKey({
      name: 'purchase_costs_goods_receipt_tenant_fk',
      columns: [table.goodsReceiptId, table.organizationId],
      foreignColumns: [goodsReceipts.id, goodsReceipts.organizationId],
    }),
  ],
);
