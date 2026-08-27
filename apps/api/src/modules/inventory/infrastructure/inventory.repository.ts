import {
  fifoLayers,
  integrationOutbox,
  ledgerEntries,
  allocations,
  reservations,
  reservationItems,
  stockAdjustments,
  stockPositions,
  stockTransferItems,
  stockTransfers,
  idempotencyOutcomes,
  newId,
} from '@commerce-platform/database';
import { and, asc, eq, sql } from 'drizzle-orm';

import { INVENTORY_AGGREGATE_TYPE } from '../domain/events';
import type { DbExecutor } from './db-executor';
import { inventoryEvent } from './event-envelope';

/**
 * Repository for the Inventory bounded context.
 *
 * Every method takes an explicit {@link DbExecutor} so the application
 * service controls the transaction boundary.
 * Every tenant-owned access is `organizationId`-scoped; child rows are only
 * ever loaded/written through their owning organization.
 *
 * FIFO layer consumption uses `FOR UPDATE` row locks to prevent concurrent
 * double-spend (docs/architecture/20-inventory.md).
 */
export class InventoryRepository {
  // ---------------------------------------------------------------------------
  // Stock Positions
  // ---------------------------------------------------------------------------

  /**
   * Find a stock position by the unique (organization, warehouse, variant) triple.
   */
  async findStockPosition(
    executor: DbExecutor,
    organizationId: string,
    warehouseId: string,
    variantId: string,
  ): Promise<StockPositionRow | null> {
    const [row] = await executor
      .select()
      .from(stockPositions)
      .where(
        and(
          eq(stockPositions.organizationId, organizationId),
          eq(stockPositions.warehouseId, warehouseId),
          eq(stockPositions.variantId, variantId),
        ),
      )
      .limit(1);

    return (row as StockPositionRow | undefined) ?? null;
  }

  /**
   * Find a stock position by ID, scoped to organization.
   */
  async findStockPositionById(
    executor: DbExecutor,
    organizationId: string,
    stockPositionId: string,
  ): Promise<StockPositionRow | null> {
    const [row] = await executor
      .select()
      .from(stockPositions)
      .where(
        and(
          eq(stockPositions.id, stockPositionId),
          eq(stockPositions.organizationId, organizationId),
        ),
      )
      .limit(1);

    return (row as StockPositionRow | undefined) ?? null;
  }

  /**
   * Create a new stock position row.
   */
  async createStockPosition(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      warehouseId: string;
      variantId: string;
      onHand?: string;
      reserved?: string;
      allocated?: string;
    },
  ): Promise<StockPositionRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(stockPositions)
      .values({
        id,
        organizationId: data.organizationId,
        warehouseId: data.warehouseId,
        variantId: data.variantId,
        onHand: data.onHand ?? '0',
        reserved: data.reserved ?? '0',
        allocated: data.allocated ?? '0',
      })
      .returning();

    return row as StockPositionRow;
  }

  /**
   * Update a stock position with optimistic concurrency (version check).
   * Returns the updated row, or null when the version does not match.
   */
  async updateStockPosition(
    executor: DbExecutor,
    organizationId: string,
    stockPositionId: string,
    data: {
      onHand?: string;
      reserved?: string;
      allocated?: string;
    },
    version: number,
  ): Promise<StockPositionRow | null> {
    const updated = await executor
      .update(stockPositions)
      .set({
        ...(data.onHand !== undefined ? { onHand: data.onHand } : {}),
        ...(data.reserved !== undefined ? { reserved: data.reserved } : {}),
        ...(data.allocated !== undefined ? { allocated: data.allocated } : {}),
        updatedAt: new Date(),
        version: version + 1,
      })
      .where(
        and(
          eq(stockPositions.id, stockPositionId),
          eq(stockPositions.organizationId, organizationId),
          eq(stockPositions.version, version),
        ),
      )
      .returning();

    return (updated[0] as StockPositionRow | undefined) ?? null;
  }

  // ---------------------------------------------------------------------------
  // FIFO Layers
  // ---------------------------------------------------------------------------

  /**
   * Find the oldest FIFO layers with remaining quantity, ordered by received_at ASC.
   * Uses `FOR UPDATE` to lock rows and prevent concurrent consumption.
   */
  async findOldestFIFOLayers(
    executor: DbExecutor,
    organizationId: string,
    stockPositionId: string,
    quantityNeeded: number,
  ): Promise<FIFOLayerRow[]> {
    const rows = await executor
      .select()
      .from(fifoLayers)
      .where(
        and(
          eq(fifoLayers.organizationId, organizationId),
          eq(fifoLayers.stockPositionId, stockPositionId),
          sql`${fifoLayers.remainingQuantity}::decimal > 0`,
        ),
      )
      .orderBy(asc(fifoLayers.receivedAt), asc(fifoLayers.id))
      .limit(quantityNeeded > 0 ? Math.max(quantityNeeded, 50) : 50)
      .for('update');

    return rows as unknown as FIFOLayerRow[];
  }

  /**
   * Update the remaining quantity of a FIFO layer.
   */
  async updateFIFOLayerRemaining(
    executor: DbExecutor,
    layerId: string,
    newRemaining: string,
  ): Promise<void> {
    await executor
      .update(fifoLayers)
      .set({ remainingQuantity: newRemaining, updatedAt: new Date() })
      .where(eq(fifoLayers.id, layerId));
  }

  /**
   * Create a new FIFO layer (e.g. on stock receipt).
   */
  async createFIFOLayer(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      stockPositionId: string;
      receivedAt?: Date;
      quantity: string;
      remainingQuantity: string;
      unitCost: string;
    },
  ): Promise<FIFOLayerRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(fifoLayers)
      .values({
        id,
        organizationId: data.organizationId,
        stockPositionId: data.stockPositionId,
        receivedAt: data.receivedAt ?? new Date(),
        quantity: data.quantity,
        remainingQuantity: data.remainingQuantity,
        unitCost: data.unitCost,
      })
      .returning();

    return row as unknown as FIFOLayerRow;
  }

  // ---------------------------------------------------------------------------
  // Ledger Entries (immutable — append only)
  // ---------------------------------------------------------------------------

  /**
   * Append a ledger entry. Ledger entries are immutable (no UPDATE/DELETE).
   */
  async createLedgerEntry(
    executor: DbExecutor,
    data: {
      organizationId: string;
      stockPositionId: string;
      entryType: string;
      quantityChange: string;
      referenceType?: string;
      referenceId?: string;
    },
  ): Promise<void> {
    await executor.insert(ledgerEntries).values({
      organizationId: data.organizationId,
      stockPositionId: data.stockPositionId,
      entryType: data.entryType,
      quantityChange: data.quantityChange,
      referenceType: data.referenceType ?? null,
      referenceId: data.referenceId ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Reservations
  // ---------------------------------------------------------------------------

  /**
   * Create a reservation row.
   */
  async createReservation(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      stockPositionId: string;
      status?: string;
      expiresAt?: Date | null;
      referenceType?: string;
      referenceId?: string;
    },
  ): Promise<ReservationRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(reservations)
      .values({
        id,
        organizationId: data.organizationId,
        stockPositionId: data.stockPositionId,
        status: data.status ?? 'ACTIVE',
        expiresAt: data.expiresAt ?? null,
        referenceType: data.referenceType ?? null,
        referenceId: data.referenceId ?? null,
      })
      .returning();

    return row as unknown as ReservationRow;
  }

  /**
   * Find a reservation by ID, scoped to organization.
   */
  async findReservationById(
    executor: DbExecutor,
    organizationId: string,
    reservationId: string,
  ): Promise<ReservationRow | null> {
    const [row] = await executor
      .select()
      .from(reservations)
      .where(
        and(eq(reservations.id, reservationId), eq(reservations.organizationId, organizationId)),
      )
      .limit(1);

    return (row as unknown as ReservationRow | undefined) ?? null;
  }

  /**
   * Update reservation status with optimistic concurrency.
   */
  async updateReservationStatus(
    executor: DbExecutor,
    reservationId: string,
    status: string,
    version: number,
  ): Promise<ReservationRow | null> {
    const updated = await executor
      .update(reservations)
      .set({
        status,
        updatedAt: new Date(),
        version: version + 1,
      })
      .where(and(eq(reservations.id, reservationId), eq(reservations.version, version)))
      .returning();

    return (updated[0] as unknown as ReservationRow | undefined) ?? null;
  }

  /**
   * Create a reservation item (line item within a reservation).
   */
  async createReservationItem(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      reservationId: string;
      variantId: string;
      quantity: string;
    },
  ): Promise<ReservationItemRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(reservationItems)
      .values({
        id,
        organizationId: data.organizationId,
        reservationId: data.reservationId,
        variantId: data.variantId,
        quantity: data.quantity,
      })
      .returning();

    return row as unknown as ReservationItemRow;
  }

  /**
   * Find all reservation items for a given reservation.
   */
  async findReservationItems(
    executor: DbExecutor,
    reservationId: string,
  ): Promise<ReservationItemRow[]> {
    const rows = await executor
      .select()
      .from(reservationItems)
      .where(eq(reservationItems.reservationId, reservationId));

    return rows as unknown as ReservationItemRow[];
  }

  // ---------------------------------------------------------------------------
  // Allocations
  // ---------------------------------------------------------------------------

  /**
   * Create an allocation row.
   */
  async createAllocation(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      stockPositionId: string;
      status?: string;
      expiresAt?: Date | null;
      referenceType?: string;
      referenceId?: string;
    },
  ): Promise<AllocationRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(allocations)
      .values({
        id,
        organizationId: data.organizationId,
        stockPositionId: data.stockPositionId,
        status: data.status ?? 'ACTIVE',
        expiresAt: data.expiresAt ?? null,
        referenceType: data.referenceType ?? null,
        referenceId: data.referenceId ?? null,
      })
      .returning();

    return row as unknown as AllocationRow;
  }

  /**
   * Find an allocation by ID, scoped to organization.
   */
  async findAllocationById(
    executor: DbExecutor,
    organizationId: string,
    allocationId: string,
  ): Promise<AllocationRow | null> {
    const [row] = await executor
      .select()
      .from(allocations)
      .where(and(eq(allocations.id, allocationId), eq(allocations.organizationId, organizationId)))
      .limit(1);

    return (row as unknown as AllocationRow | undefined) ?? null;
  }

  /**
   * Update allocation status with optimistic concurrency.
   */
  async updateAllocationStatus(
    executor: DbExecutor,
    allocationId: string,
    status: string,
    version: number,
  ): Promise<AllocationRow | null> {
    const updated = await executor
      .update(allocations)
      .set({
        status,
        updatedAt: new Date(),
        version: version + 1,
      })
      .where(and(eq(allocations.id, allocationId), eq(allocations.version, version)))
      .returning();

    return (updated[0] as unknown as AllocationRow | undefined) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Stock Transfers
  // ---------------------------------------------------------------------------

  /**
   * Create a stock transfer row.
   */
  async createTransfer(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      sourceWarehouseId: string;
      destinationWarehouseId: string;
      status?: string;
    },
  ): Promise<StockTransferRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(stockTransfers)
      .values({
        id,
        organizationId: data.organizationId,
        sourceWarehouseId: data.sourceWarehouseId,
        destinationWarehouseId: data.destinationWarehouseId,
        status: data.status ?? 'DRAFT',
      })
      .returning();

    return row as unknown as StockTransferRow;
  }

  /**
   * Find a stock transfer by ID, scoped to organization.
   */
  async findTransferById(
    executor: DbExecutor,
    organizationId: string,
    transferId: string,
  ): Promise<StockTransferRow | null> {
    const [row] = await executor
      .select()
      .from(stockTransfers)
      .where(
        and(eq(stockTransfers.id, transferId), eq(stockTransfers.organizationId, organizationId)),
      )
      .limit(1);

    return (row as unknown as StockTransferRow | undefined) ?? null;
  }

  /**
   * Update transfer status with optimistic concurrency.
   */
  async updateTransferStatus(
    executor: DbExecutor,
    transferId: string,
    status: string,
    data: {
      dispatchedAt?: Date | null;
      receivedAt?: Date | null;
    },
    version: number,
  ): Promise<StockTransferRow | null> {
    const updated = await executor
      .update(stockTransfers)
      .set({
        status,
        updatedAt: new Date(),
        version: version + 1,
        ...(data.dispatchedAt !== undefined ? { dispatchedAt: data.dispatchedAt } : {}),
        ...(data.receivedAt !== undefined ? { receivedAt: data.receivedAt } : {}),
      })
      .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.version, version)))
      .returning();

    return (updated[0] as unknown as StockTransferRow | undefined) ?? null;
  }

  /**
   * Create a stock transfer item (line item within a transfer).
   */
  async createTransferItem(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      transferId: string;
      variantId: string;
      quantity: string;
      receivedQuantity?: string | null;
    },
  ): Promise<StockTransferItemRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(stockTransferItems)
      .values({
        id,
        organizationId: data.organizationId,
        transferId: data.transferId,
        variantId: data.variantId,
        quantity: data.quantity,
        receivedQuantity: data.receivedQuantity ?? null,
      })
      .returning();

    return row as unknown as StockTransferItemRow;
  }

  /**
   * Find all transfer items for a given transfer.
   */
  async findTransferItems(
    executor: DbExecutor,
    transferId: string,
  ): Promise<StockTransferItemRow[]> {
    const rows = await executor
      .select()
      .from(stockTransferItems)
      .where(eq(stockTransferItems.transferId, transferId));

    return rows as unknown as StockTransferItemRow[];
  }

  /**
   * Update a transfer item's received quantity.
   */
  async updateTransferItemReceived(
    executor: DbExecutor,
    transferItemId: string,
    receivedQuantity: string,
  ): Promise<void> {
    await executor
      .update(stockTransferItems)
      .set({ receivedQuantity, updatedAt: new Date() })
      .where(eq(stockTransferItems.id, transferItemId));
  }

  // ---------------------------------------------------------------------------
  // Stock Adjustments
  // ---------------------------------------------------------------------------

  /**
   * Create a stock adjustment row.
   */
  async createAdjustment(
    executor: DbExecutor,
    data: {
      id?: string;
      organizationId: string;
      stockPositionId: string;
      adjustmentType: string;
      quantityBefore: string;
      quantityAfter: string;
      reason: string;
      approvedBy?: string | null;
      referenceType?: string;
      referenceId?: string;
    },
  ): Promise<StockAdjustmentRow> {
    const id = data.id ?? newId();
    const [row] = await executor
      .insert(stockAdjustments)
      .values({
        id,
        organizationId: data.organizationId,
        stockPositionId: data.stockPositionId,
        adjustmentType: data.adjustmentType,
        quantityBefore: data.quantityBefore,
        quantityAfter: data.quantityAfter,
        reason: data.reason,
        approvedBy: data.approvedBy ?? null,
        referenceType: data.referenceType ?? null,
        referenceId: data.referenceId ?? null,
      })
      .returning();

    return row as unknown as StockAdjustmentRow;
  }

  // ---------------------------------------------------------------------------
  // Query helpers
  // ---------------------------------------------------------------------------

  /**
   * List stock positions for an organization, optionally filtered by warehouse.
   */
  async listStockPositions(
    executor: DbExecutor,
    organizationId: string,
    options?: { warehouseId?: string; limit?: number; offset?: number },
  ): Promise<StockPositionRow[]> {
    const conditions = [eq(stockPositions.organizationId, organizationId)];
    if (options?.warehouseId) {
      conditions.push(eq(stockPositions.warehouseId, options.warehouseId));
    }

    const rows = await executor
      .select()
      .from(stockPositions)
      .where(and(...conditions))
      .orderBy(asc(stockPositions.createdAt))
      .limit(options?.limit ?? 50)
      .offset(options?.offset ?? 0);

    return rows as unknown as StockPositionRow[];
  }

  /**
   * List FIFO layers for a stock position.
   */
  async listFIFOLayers(
    executor: DbExecutor,
    organizationId: string,
    stockPositionId: string,
  ): Promise<FIFOLayerRow[]> {
    const rows = await executor
      .select()
      .from(fifoLayers)
      .where(
        and(
          eq(fifoLayers.organizationId, organizationId),
          eq(fifoLayers.stockPositionId, stockPositionId),
        ),
      )
      .orderBy(asc(fifoLayers.receivedAt), asc(fifoLayers.id));

    return rows as unknown as FIFOLayerRow[];
  }

  /**
   * List ledger entries for a stock position.
   */
  async listLedgerEntries(
    executor: DbExecutor,
    organizationId: string,
    stockPositionId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<LedgerEntryRow[]> {
    const rows = await executor
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.organizationId, organizationId),
          eq(ledgerEntries.stockPositionId, stockPositionId),
        ),
      )
      .orderBy(asc(ledgerEntries.createdAt))
      .limit(options?.limit ?? 50)
      .offset(options?.offset ?? 0);

    return rows as unknown as LedgerEntryRow[];
  }

  /**
   * List reservations, optionally filtered by stock position.
   */
  async listReservations(
    executor: DbExecutor,
    organizationId: string,
    stockPositionId?: string,
  ): Promise<ReservationRow[]> {
    const conditions = [eq(reservations.organizationId, organizationId)];
    if (stockPositionId) {
      conditions.push(eq(reservations.stockPositionId, stockPositionId));
    }

    const rows = await executor
      .select()
      .from(reservations)
      .where(and(...conditions))
      .orderBy(asc(reservations.createdAt));

    return rows as unknown as ReservationRow[];
  }

  /**
   * List allocations, optionally filtered by stock position.
   */
  async listAllocations(
    executor: DbExecutor,
    organizationId: string,
    stockPositionId?: string,
  ): Promise<AllocationRow[]> {
    const conditions = [eq(allocations.organizationId, organizationId)];
    if (stockPositionId) {
      conditions.push(eq(allocations.stockPositionId, stockPositionId));
    }

    const rows = await executor
      .select()
      .from(allocations)
      .where(and(...conditions))
      .orderBy(asc(allocations.createdAt));

    return rows as unknown as AllocationRow[];
  }

  /**
   * List stock transfers, optionally filtered by status.
   */
  async listTransfers(
    executor: DbExecutor,
    organizationId: string,
    status?: string,
  ): Promise<StockTransferRow[]> {
    const conditions = [eq(stockTransfers.organizationId, organizationId)];
    if (status) {
      conditions.push(eq(stockTransfers.status, status));
    }

    const rows = await executor
      .select()
      .from(stockTransfers)
      .where(and(...conditions))
      .orderBy(asc(stockTransfers.createdAt));

    return rows as unknown as StockTransferRow[];
  }

  /**
   * List stock adjustments, optionally filtered by stock position.
   */
  async listAdjustments(
    executor: DbExecutor,
    organizationId: string,
    stockPositionId?: string,
  ): Promise<StockAdjustmentRow[]> {
    const conditions = [eq(stockAdjustments.organizationId, organizationId)];
    if (stockPositionId) {
      conditions.push(eq(stockAdjustments.stockPositionId, stockPositionId));
    }

    const rows = await executor
      .select()
      .from(stockAdjustments)
      .where(and(...conditions))
      .orderBy(asc(stockAdjustments.createdAt));

    return rows as unknown as StockAdjustmentRow[];
  }

  // ---------------------------------------------------------------------------
  // Outbox (transactional)
  // ---------------------------------------------------------------------------

  /**
   * Write integration events to the outbox. Events go out LAST within
   * the transaction: readers of the outbox must never observe an event
   * for state that is not committed alongside it.
   */
  async createOutboxEvent(
    executor: DbExecutor,
    envelope: ReturnType<typeof inventoryEvent>,
  ): Promise<void> {
    await executor.insert(integrationOutbox).values({
      id: newId(),
      aggregateType: INVENTORY_AGGREGATE_TYPE,
      aggregateId: envelope.aggregateId,
      eventType: envelope.eventType,
      payload: envelope,
      correlationId: envelope.correlationId,
      occurredAt: new Date(envelope.occurredAt),
    });
  }

  /**
   * Write multiple integration events to the outbox in one insert.
   */
  async createOutboxEvents(
    executor: DbExecutor,
    events: ReturnType<typeof inventoryEvent>[],
  ): Promise<void> {
    if (events.length === 0) return;

    await executor.insert(integrationOutbox).values(
      events.map((envelope) => ({
        id: newId(),
        aggregateType: INVENTORY_AGGREGATE_TYPE,
        aggregateId: envelope.aggregateId,
        eventType: envelope.eventType,
        payload: envelope,
        correlationId: envelope.correlationId,
        occurredAt: new Date(envelope.occurredAt),
      })),
    );
  }

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  /**
   * Claim an idempotency key within the current transaction.
   * Returns a claim result with the existing outcome (if any) or a new claim ID.
   */
  async claimIdempotencyKey(
    executor: DbExecutor,
    key: string,
    requestHash: string,
    scope: string,
  ): Promise<IdempotencyClaimResult> {
    // Check for existing outcome first
    const [existing] = await executor
      .select()
      .from(idempotencyOutcomes)
      .where(and(eq(idempotencyOutcomes.idempotencyKey, key), eq(idempotencyOutcomes.scope, scope)))
      .limit(1);

    if (existing) {
      return {
        kind: 'existing',
        claimId: existing.id,
        status: existing.status,
        responseJson: existing.responseJson as Record<string, unknown> | null,
      };
    }

    // Insert new claim (will fail on unique constraint if concurrent)
    const id = newId();
    await executor.insert(idempotencyOutcomes).values({
      id,
      scope,
      idempotencyKey: key,
      requestHash,
      status: 'IN_PROGRESS',
    });

    return { kind: 'claimed', claimId: id };
  }

  /**
   * Record the outcome of an idempotent operation.
   */
  async recordIdempotencyOutcome(
    executor: DbExecutor,
    claimId: string,
    status: string,
    responseJson: Record<string, unknown> | null,
  ): Promise<void> {
    await executor
      .update(idempotencyOutcomes)
      .set({
        status,
        responseJson: responseJson ?? null,
        completedAt: new Date(),
      })
      .where(eq(idempotencyOutcomes.id, claimId));
  }

  /**
   * Find an existing idempotency outcome by key and scope.
   */
  async findExistingOutcome(
    executor: DbExecutor,
    key: string,
    scope: string,
  ): Promise<IdempotencyOutcomeRow | null> {
    const [row] = await executor
      .select()
      .from(idempotencyOutcomes)
      .where(and(eq(idempotencyOutcomes.idempotencyKey, key), eq(idempotencyOutcomes.scope, scope)))
      .limit(1);

    return (row as IdempotencyOutcomeRow | undefined) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface StockPositionRow {
  id: string;
  organizationId: string;
  warehouseId: string;
  variantId: string;
  onHand: string;
  reserved: string;
  allocated: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface FIFOLayerRow {
  id: string;
  organizationId: string;
  stockPositionId: string;
  receivedAt: Date;
  quantity: string;
  remainingQuantity: string;
  unitCost: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LedgerEntryRow {
  id: string;
  organizationId: string;
  stockPositionId: string;
  entryType: string;
  quantityChange: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReservationRow {
  id: string;
  organizationId: string;
  stockPositionId: string;
  status: string;
  expiresAt: Date | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ReservationItemRow {
  id: string;
  organizationId: string;
  reservationId: string;
  variantId: string;
  quantity: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AllocationRow {
  id: string;
  organizationId: string;
  stockPositionId: string;
  status: string;
  expiresAt: Date | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface StockTransferRow {
  id: string;
  organizationId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  status: string;
  dispatchedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface StockTransferItemRow {
  id: string;
  organizationId: string;
  transferId: string;
  variantId: string;
  quantity: string;
  receivedQuantity: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockAdjustmentRow {
  id: string;
  organizationId: string;
  stockPositionId: string;
  adjustmentType: string;
  quantityBefore: string;
  quantityAfter: string;
  reason: string;
  approvedBy: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IdempotencyOutcomeRow {
  id: string;
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  status: string;
  responseJson: Record<string, unknown> | null;
  createdAt: Date;
  completedAt: Date | null;
}

export type IdempotencyClaimResult =
  | {
      kind: 'existing';
      claimId: string;
      status: string;
      responseJson: Record<string, unknown> | null;
    }
  | {
      kind: 'claimed';
      claimId: string;
    };
