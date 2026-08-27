import {
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
import { idColumn, idColumnDbGenerated, optimisticVersion, timestamps } from './shared';

/**
 * Inventory bounded context (docs/architecture/20-inventory.md).
 *
 * Logical schema `inventory`:
 * stock_positions / fifo_layers / ledger_entries /
 * reservations / reservation_items / allocations /
 * stock_transfers / stock_transfer_items / stock_adjustments.
 *
 * Conventions:
 * - Every tenant-owned row carries `organization_id`.
 * - Business uniqueness is UNIQUE (organization_id, business_key).
 * - Composite tenant FKs anchor child rows to the owning organization.
 * - Quantities and costs are decimal(14,4), never float.
 * - Ledger entries are append-only (UPDATE/DELETE triggers in M3).
 * - FIFO layers are consumed oldest-first via partial index.
 */
export const inventorySchema = pgSchema('inventory');

/* -------------------------------------------------------------------------- */
/* Stock Positions — Core Aggregate Identity                                   */
/* -------------------------------------------------------------------------- */

export const STOCK_POSITION_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type StockPositionStatus = (typeof STOCK_POSITION_STATUSES)[number];

/**
 * One row per (organization, warehouse, variant).
 *
 * `on_hand` is the total physical quantity. `reserved` and `allocated` are
 * subsets of `on_hand` enforced by CHECK: reserved + allocated <= on_hand.
 *
 * `version` supports optimistic concurrency on balance mutations.
 */
export const stockPositions = inventorySchema.table(
  'stock_positions',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    onHand: decimal('on_hand', { precision: 14, scale: 4 }).notNull().default('0'),
    reserved: decimal('reserved', { precision: 14, scale: 4 }).notNull().default('0'),
    allocated: decimal('allocated', { precision: 14, scale: 4 }).notNull().default('0'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    uniqueIndex('stock_positions_org_warehouse_variant_unique').on(
      table.organizationId,
      table.warehouseId,
      table.variantId,
    ),
    // Tenant-scope unique for FK references from child tables (fifo_layers, ledger_entries, etc.)
    uniqueIndex('stock_positions_tenant_scope_unique').on(table.id, table.organizationId),
    index('stock_positions_organization_id_idx').on(table.organizationId),
    index('stock_positions_org_warehouse_idx').on(table.organizationId, table.warehouseId),
    // CHECK: on_hand >= 0
    // CHECK: reserved >= 0
    // CHECK: allocated >= 0
    // CHECK: reserved + allocated <= on_hand
    // (Drizzle does not support CHECK inline; these are in the SQL migration)
    foreignKey({
      name: 'stock_positions_warehouse_tenant_fk',
      columns: [table.warehouseId, table.organizationId],
      foreignColumns: [warehouses.id, warehouses.organizationId],
    }),
    foreignKey({
      name: 'stock_positions_variant_tenant_fk',
      columns: [table.variantId, table.organizationId],
      foreignColumns: [productVariants.id, productVariants.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* FIFO Layers — Cost Layers                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Append-only cost layers for FIFO consumption.
 *
 * Each receipt creates a new layer with `quantity` = `remaining_quantity`.
 * Consumption decrements `remaining_quantity` oldest-first (by received_at).
 * The partial index `fifo_layers_consumption_idx` accelerates this query.
 */
export const fifoLayers = inventorySchema.table(
  'fifo_layers',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    stockPositionId: uuid('stock_position_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    quantity: decimal('quantity', { precision: 14, scale: 4 }).notNull(),
    remainingQuantity: decimal('remaining_quantity', { precision: 14, scale: 4 }).notNull(),
    unitCost: decimal('unit_cost', { precision: 14, scale: 4 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('fifo_layers_stock_position_id_idx').on(table.stockPositionId),
    // Partial index for FIFO consumption: only active layers
    // CREATE INDEX IF NOT EXISTS fifo_layers_consumption_idx
    //   ON inventory.fifo_layers (organization_id, warehouse_id, variant_id, received_at, id)
    //   WHERE remaining_quantity > 0;
    // (warehouse_id and variant_id are resolved from stock_positions; Drizzle
    //  cannot express the JOIN-based partial index, so this is in the SQL migration)
    foreignKey({
      name: 'fifo_layers_stock_position_tenant_fk',
      columns: [table.stockPositionId, table.organizationId],
      foreignColumns: [stockPositions.id, stockPositions.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Ledger Entries — Immutable History                                         */
/* -------------------------------------------------------------------------- */

export const LEDGER_ENTRY_TYPES = [
  'RECEIPT',
  'CONSUMPTION',
  'RESERVATION',
  'RELEASE',
  'ALLOCATION',
  'DEALLOCATION',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/**
 * Append-only ledger recording every stock movement.
 *
 * Uses `idColumnDbGenerated` (DB-side gen_random_uuid) because ledger writes
 * may bypass the application layer (e.g. direct SQL triggers).
 *
 * `reference_type` + `reference_id` link to the originating domain event
 * (reservation, allocation, transfer, adjustment).
 */
export const ledgerEntries = inventorySchema.table(
  'ledger_entries',
  {
    id: idColumnDbGenerated(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    stockPositionId: uuid('stock_position_id').notNull(),
    entryType: text('entry_type').notNull(),
    quantityChange: decimal('quantity_change', { precision: 14, scale: 4 }).notNull(),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    ...timestamps,
  },
  (table) => [
    index('ledger_entries_organization_id_idx').on(table.organizationId),
    index('ledger_entries_stock_position_id_idx').on(table.stockPositionId),
    index('ledger_entries_reference_idx').on(table.referenceType, table.referenceId),
    foreignKey({
      name: 'ledger_entries_stock_position_tenant_fk',
      columns: [table.stockPositionId, table.organizationId],
      foreignColumns: [stockPositions.id, stockPositions.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Reservations — Hold Stock                                                  */
/* -------------------------------------------------------------------------- */

export const RESERVATION_STATUSES = ['ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * Temporary hold on stock (e.g. pending POS sale).
 *
 * `expires_at` enables automatic expiration of stale reservations.
 * `version` supports optimistic concurrency on status transitions.
 */
export const reservations = inventorySchema.table(
  'reservations',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    stockPositionId: uuid('stock_position_id').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    index('reservations_organization_id_idx').on(table.organizationId),
    index('reservations_stock_position_id_idx').on(table.stockPositionId),
    index('reservations_status_idx').on(table.status),
    // Tenant-scope unique for FK references from child tables (reservation_items)
    uniqueIndex('reservations_tenant_scope_unique').on(table.id, table.organizationId),
    foreignKey({
      name: 'reservations_stock_position_tenant_fk',
      columns: [table.stockPositionId, table.organizationId],
      foreignColumns: [stockPositions.id, stockPositions.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Reservation Items — Line Items                                             */
/* -------------------------------------------------------------------------- */

/**
 * Individual variant quantities within a reservation.
 */
export const reservationItems = inventorySchema.table(
  'reservation_items',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reservationId: uuid('reservation_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    quantity: decimal('quantity', { precision: 14, scale: 4 }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('reservation_items_reservation_id_idx').on(table.reservationId),
    foreignKey({
      name: 'reservation_items_reservation_tenant_fk',
      columns: [table.reservationId, table.organizationId],
      foreignColumns: [reservations.id, reservations.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Allocations — Committed Stock                                              */
/* -------------------------------------------------------------------------- */

export const ALLOCATION_STATUSES = ['ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED'] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUSES)[number];

/**
 * Confirmed stock commitment (e.g. fulfilled order).
 *
 * Unlike reservations, allocations represent irreversible commitments.
 * `version` supports optimistic concurrency on status transitions.
 */
export const allocations = inventorySchema.table(
  'allocations',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    stockPositionId: uuid('stock_position_id').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    index('allocations_organization_id_idx').on(table.organizationId),
    index('allocations_stock_position_id_idx').on(table.stockPositionId),
    index('allocations_status_idx').on(table.status),
    foreignKey({
      name: 'allocations_stock_position_tenant_fk',
      columns: [table.stockPositionId, table.organizationId],
      foreignColumns: [stockPositions.id, stockPositions.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Stock Transfers — Move Between Warehouses                                  */
/* -------------------------------------------------------------------------- */

export const STOCK_TRANSFER_STATUSES = [
  'DRAFT',
  'DISPATCHED',
  'IN_TRANSIT',
  'RECEIVED',
  'CANCELLED',
] as const;
export type StockTransferStatus = (typeof STOCK_TRANSFER_STATUSES)[number];

/**
 * Transfer of stock from one warehouse to another within the same organization.
 *
 * Lifecycle: DRAFT → DISPATCHED → IN_TRANSIT → RECEIVED (or CANCELLED).
 * `dispatched_at` and `received_at` capture the transition timestamps.
 * `version` supports optimistic concurrency on status transitions.
 */
export const stockTransfers = inventorySchema.table(
  'stock_transfers',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sourceWarehouseId: uuid('source_warehouse_id').notNull(),
    destinationWarehouseId: uuid('destination_warehouse_id').notNull(),
    status: text('status').notNull().default('DRAFT'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    index('stock_transfers_organization_id_idx').on(table.organizationId),
    index('stock_transfers_source_warehouse_id_idx').on(table.sourceWarehouseId),
    index('stock_transfers_destination_warehouse_id_idx').on(table.destinationWarehouseId),
    index('stock_transfers_status_idx').on(table.status),
    // Tenant-scope unique for FK references from child tables (stock_transfer_items)
    uniqueIndex('stock_transfers_tenant_scope_unique').on(table.id, table.organizationId),
    foreignKey({
      name: 'stock_transfers_source_warehouse_tenant_fk',
      columns: [table.sourceWarehouseId, table.organizationId],
      foreignColumns: [warehouses.id, warehouses.organizationId],
    }),
    foreignKey({
      name: 'stock_transfers_dest_warehouse_tenant_fk',
      columns: [table.destinationWarehouseId, table.organizationId],
      foreignColumns: [warehouses.id, warehouses.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Stock Transfer Items — Line Items                                          */
/* -------------------------------------------------------------------------- */

/**
 * Individual variant quantities within a transfer.
 *
 * `received_quantity` is NULL until the transfer is received at the
 * destination warehouse, enabling partial receipt tracking.
 */
export const stockTransferItems = inventorySchema.table(
  'stock_transfer_items',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    transferId: uuid('transfer_id').notNull(),
    variantId: uuid('variant_id').notNull(),
    quantity: decimal('quantity', { precision: 14, scale: 4 }).notNull(),
    receivedQuantity: decimal('received_quantity', { precision: 14, scale: 4 }),
    ...timestamps,
  },
  (table) => [
    index('stock_transfer_items_transfer_id_idx').on(table.transferId),
    foreignKey({
      name: 'stock_transfer_items_transfer_tenant_fk',
      columns: [table.transferId, table.organizationId],
      foreignColumns: [stockTransfers.id, stockTransfers.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Stock Adjustments — Audit Trail for Corrections                            */
/* -------------------------------------------------------------------------- */

export const ADJUSTMENT_TYPES = ['INCREASE', 'DECREASE', 'CORRECTION'] as const;
export type AdjustmentType = (typeof ADJUSTMENT_TYPES)[number];

/**
 * Immutable audit record for manual stock corrections.
 *
 * Captures before/after quantities and the reason for the adjustment.
 * `approved_by` references the identity user who authorized the change.
 */
export const stockAdjustments = inventorySchema.table(
  'stock_adjustments',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    stockPositionId: uuid('stock_position_id').notNull(),
    adjustmentType: text('adjustment_type').notNull(),
    quantityBefore: decimal('quantity_before', { precision: 14, scale: 4 }).notNull(),
    quantityAfter: decimal('quantity_after', { precision: 14, scale: 4 }).notNull(),
    reason: text('reason').notNull(),
    approvedBy: uuid('approved_by'),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    ...timestamps,
  },
  (table) => [
    index('stock_adjustments_organization_id_idx').on(table.organizationId),
    index('stock_adjustments_stock_position_id_idx').on(table.stockPositionId),
    foreignKey({
      name: 'stock_adjustments_stock_position_tenant_fk',
      columns: [table.stockPositionId, table.organizationId],
      foreignColumns: [stockPositions.id, stockPositions.organizationId],
    }),
  ],
);
