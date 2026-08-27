import { type DatabaseClient } from '@commerce-platform/database';
import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../database/database.tokens';
import {
  InventoryRepository,
  type StockPositionRow,
  type FIFOLayerRow,
  type LedgerEntryRow,
  type ReservationRow,
  type AllocationRow,
  type StockTransferRow,
  type StockAdjustmentRow,
} from '../infrastructure/inventory.repository';
import { inventoryEvent } from '../infrastructure/event-envelope';
import type { DbExecutor } from '../infrastructure/db-executor';

/**
 * Application service of the Inventory context: one method per domain
 * command, each executed inside a single database transaction that:
 *
 * 1. Locks the stock position (SELECT ... FOR UPDATE)
 * 2. Validates business rules
 * 3. Locks oldest FIFO layers (SELECT ... FOR UPDATE)
 * 4. Consumes layers / adjusts balances
 * 5. Creates ledger entries
 * 6. Writes Outbox events
 * 7. Records idempotency outcome
 *
 * Authentication, authorization and entitlement checks are intentionally NOT
 * part of this service; they live in the HTTP controller layer.
 *
 * All quantities are decimal strings (never JS numbers for DB storage).
 * Available = OnHand - Reserved - Allocated.
 * FIFO: consume oldest layer first (ORDER BY received_at ASC, id ASC).
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(InventoryRepository) private readonly repository: InventoryRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Stock Receipt
  // ---------------------------------------------------------------------------

  async receiveStock(params: {
    organizationId: string;
    warehouseId: string;
    variantId: string;
    quantity: string;
    unitCost: string;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ received: StockPositionRow }> {
    const quantityNum = parseFloat(params.quantity);
    if (quantityNum <= 0) {
      throw PlatformError.validationFailed('Receive quantity must be positive.', {
        details: { quantity: params.quantity },
      });
    }

    const idempotencyScope = `inventory:receiveStock:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      // Idempotency check
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { received: StockPositionRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      // Find or create stock position (SELECT ... FOR UPDATE via optimistic concurrency)
      let stockPos = await this.repository.findStockPosition(
        tx,
        params.organizationId,
        params.warehouseId,
        params.variantId,
      );

      const events: ReturnType<typeof inventoryEvent>[] = [];

      if (!stockPos) {
        stockPos = await this.repository.createStockPosition(tx, {
          organizationId: params.organizationId,
          warehouseId: params.warehouseId,
          variantId: params.variantId,
          onHand: params.quantity,
        });

        events.push(
          inventoryEvent(
            'inventory.stock-position-created',
            params.organizationId,
            'StockPosition',
            stockPos.id,
            stockPos.version,
            params.idempotencyKey,
            params.idempotencyKey,
            params.principal.id,
            {
              warehouseId: params.warehouseId,
              variantId: params.variantId,
              onHand: params.quantity,
            },
          ),
        );
      } else {
        const newOnHand = this.decimalAdd(stockPos.onHand, params.quantity);
        const updated = await this.repository.updateStockPosition(
          tx,
          params.organizationId,
          stockPos.id,
          { onHand: newOnHand },
          stockPos.version,
        );

        if (!updated) {
          throw PlatformError.of(
            ERROR_CODES.RESOURCE_VERSION_CONFLICT,
            `Stock position ${stockPos.id} was modified concurrently.`,
            { details: { stockPositionId: stockPos.id, expectedVersion: stockPos.version } },
          );
        }
        stockPos = updated;
      }

      // Create FIFO layer for the receipt
      const receivedAt = new Date();
      const fifoLayer = await this.repository.createFIFOLayer(tx, {
        organizationId: params.organizationId,
        stockPositionId: stockPos.id,
        receivedAt,
        quantity: params.quantity,
        remainingQuantity: params.quantity,
        unitCost: params.unitCost,
      });

      // Ledger entry
      await this.repository.createLedgerEntry(tx, {
        organizationId: params.organizationId,
        stockPositionId: stockPos.id,
        entryType: 'RECEIPT',
        quantityChange: `+${params.quantity}`,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
      });

      // Outbox event
      events.push(
        inventoryEvent(
          'inventory.stock-received',
          params.organizationId,
          'StockPosition',
          stockPos.id,
          stockPos.version,
          params.idempotencyKey,
          params.idempotencyKey,
          params.principal.id,
          {
            warehouseId: params.warehouseId,
            variantId: params.variantId,
            quantity: quantityNum,
            unitCost: parseFloat(params.unitCost),
            fifoLayerId: fifoLayer.id,
          },
        ),
      );

      await this.repository.createOutboxEvents(tx, events);

      // Record idempotency outcome
      const response = { received: stockPos };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Stock Consumption
  // ---------------------------------------------------------------------------

  async consumeStock(params: {
    organizationId: string;
    warehouseId: string;
    variantId: string;
    quantity: string;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ consumed: StockPositionRow }> {
    const quantityNum = parseFloat(params.quantity);
    if (quantityNum <= 0) {
      throw PlatformError.validationFailed('Consume quantity must be positive.', {
        details: { quantity: params.quantity },
      });
    }

    const idempotencyScope = `inventory:consumeStock:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { consumed: StockPositionRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      const consumed = await this.consumeStockWithFIFO(
        tx,
        params.organizationId,
        params.warehouseId,
        params.variantId,
        params.quantity,
        {
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          correlationId: params.idempotencyKey,
          actorId: params.principal.id,
        },
      );

      const response = { consumed };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Reservation
  // ---------------------------------------------------------------------------

  async reserveStock(params: {
    organizationId: string;
    warehouseId: string;
    variantId: string;
    quantity: string;
    expiresAt?: Date | null;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ reservation: ReservationRow }> {
    const quantityNum = parseFloat(params.quantity);
    if (quantityNum <= 0) {
      throw PlatformError.validationFailed('Reserve quantity must be positive.', {
        details: { quantity: params.quantity },
      });
    }

    const idempotencyScope = `inventory:reserveStock:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { reservation: ReservationRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      const reservation = await this.reserveWithFIFO(
        tx,
        params.organizationId,
        params.warehouseId,
        params.variantId,
        params.quantity,
        {
          expiresAt: params.expiresAt,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          correlationId: params.idempotencyKey,
          actorId: params.principal.id,
        },
      );

      const response = { reservation };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  async releaseReservation(params: {
    organizationId: string;
    reservationId: string;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ released: ReservationRow }> {
    const idempotencyScope = `inventory:releaseReservation:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { released: ReservationRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      // Load reservation
      const reservation = await this.repository.findReservationById(
        tx,
        params.organizationId,
        params.reservationId,
      );

      if (!reservation) {
        throw PlatformError.notFound(`Reservation ${params.reservationId} not found.`, {
          details: { reservationId: params.reservationId, organizationId: params.organizationId },
        });
      }

      if (reservation.status !== 'ACTIVE') {
        throw PlatformError.of(
          ERROR_CODES.RESERVATION_NOT_AVAILABLE,
          `Reservation ${params.reservationId} is ${reservation.status}, not ACTIVE.`,
          { details: { reservationId: params.reservationId, status: reservation.status } },
        );
      }

      // Get reservation items to know how much to release per variant
      const items = await this.repository.findReservationItems(tx, reservation.id);

      // Release: decrease reserved on stock position for each item
      // For simplicity, a reservation currently targets one stock position (single variant)
      if (items.length > 0) {
        const stockPos = await this.repository.findStockPositionById(
          tx,
          params.organizationId,
          reservation.stockPositionId,
        );

        if (stockPos) {
          let totalReserved = '0';
          for (const item of items) {
            totalReserved = this.decimalAdd(totalReserved, item.quantity);
          }

          const newReserved = this.decimalSubtract(stockPos.reserved, totalReserved);
          const updated = await this.repository.updateStockPosition(
            tx,
            params.organizationId,
            stockPos.id,
            { reserved: newReserved },
            stockPos.version,
          );

          if (!updated) {
            throw PlatformError.of(
              ERROR_CODES.RESOURCE_VERSION_CONFLICT,
              `Stock position ${stockPos.id} was modified concurrently.`,
              { details: { stockPositionId: stockPos.id, expectedVersion: stockPos.version } },
            );
          }

          // Ledger entries for release
          for (const item of items) {
            await this.repository.createLedgerEntry(tx, {
              organizationId: params.organizationId,
              stockPositionId: stockPos.id,
              entryType: 'RELEASE',
              quantityChange: item.quantity,
              referenceType: 'RESERVATION',
              referenceId: reservation.id,
            });
          }
        }
      }

      // Update reservation status
      const updatedReservation = await this.repository.updateReservationStatus(
        tx,
        reservation.id,
        'RELEASED',
        reservation.version,
      );

      if (!updatedReservation) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Reservation ${reservation.id} was modified concurrently.`,
          { details: { reservationId: reservation.id, expectedVersion: reservation.version } },
        );
      }

      // Outbox event
      await this.repository.createOutboxEvents(tx, [
        inventoryEvent(
          'inventory.reservation-released',
          params.organizationId,
          'Reservation',
          reservation.id,
          updatedReservation.version,
          params.idempotencyKey,
          params.idempotencyKey,
          params.principal.id,
          { stockPositionId: reservation.stockPositionId },
        ),
      ]);

      const response = { released: updatedReservation };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  async consumeReservation(params: {
    organizationId: string;
    reservationId: string;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ consumed: ReservationRow }> {
    const idempotencyScope = `inventory:consumeReservation:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { consumed: ReservationRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      // Load reservation
      const reservation = await this.repository.findReservationById(
        tx,
        params.organizationId,
        params.reservationId,
      );

      if (!reservation) {
        throw PlatformError.notFound(`Reservation ${params.reservationId} not found.`, {
          details: { reservationId: params.reservationId, organizationId: params.organizationId },
        });
      }

      if (reservation.status !== 'ACTIVE') {
        throw PlatformError.of(
          ERROR_CODES.RESERVATION_ALREADY_CONSUMED,
          `Reservation ${params.reservationId} is ${reservation.status}, not ACTIVE.`,
          { details: { reservationId: params.reservationId, status: reservation.status } },
        );
      }

      // Load reservation items
      const items = await this.repository.findReservationItems(tx, reservation.id);

      // Consume: decrease on_hand and reserved, consume FIFO layers
      if (items.length > 0) {
        const stockPos = await this.repository.findStockPositionById(
          tx,
          params.organizationId,
          reservation.stockPositionId,
        );

        if (stockPos) {
          let totalQuantity = '0';
          for (const item of items) {
            totalQuantity = this.decimalAdd(totalQuantity, item.quantity);
          }

          // Consume FIFO layers
          await this.consumeFIFOLayers(tx, stockPos.id, params.organizationId, totalQuantity, {
            referenceType: 'RESERVATION',
            referenceId: reservation.id,
            correlationId: params.idempotencyKey,
            actorId: params.principal.id,
          });

          // Update stock position: decrease on_hand and reserved
          const newOnHand = this.decimalSubtract(stockPos.onHand, totalQuantity);
          const newReserved = this.decimalSubtract(stockPos.reserved, totalQuantity);
          const updated = await this.repository.updateStockPosition(
            tx,
            params.organizationId,
            stockPos.id,
            { onHand: newOnHand, reserved: newReserved },
            stockPos.version,
          );

          if (!updated) {
            throw PlatformError.of(
              ERROR_CODES.RESOURCE_VERSION_CONFLICT,
              `Stock position ${stockPos.id} was modified concurrently.`,
              { details: { stockPositionId: stockPos.id, expectedVersion: stockPos.version } },
            );
          }

          // Ledger entry for consumption
          await this.repository.createLedgerEntry(tx, {
            organizationId: params.organizationId,
            stockPositionId: stockPos.id,
            entryType: 'CONSUMPTION',
            quantityChange: `-${totalQuantity}`,
            referenceType: 'RESERVATION',
            referenceId: reservation.id,
          });
        }
      }

      // Update reservation status
      const updatedReservation = await this.repository.updateReservationStatus(
        tx,
        reservation.id,
        'CONSUMED',
        reservation.version,
      );

      if (!updatedReservation) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Reservation ${reservation.id} was modified concurrently.`,
          { details: { reservationId: reservation.id, expectedVersion: reservation.version } },
        );
      }

      // Outbox event
      await this.repository.createOutboxEvents(tx, [
        inventoryEvent(
          'inventory.reservation-consumed',
          params.organizationId,
          'Reservation',
          reservation.id,
          updatedReservation.version,
          params.idempotencyKey,
          params.idempotencyKey,
          params.principal.id,
          { stockPositionId: reservation.stockPositionId },
        ),
      ]);

      const response = { consumed: updatedReservation };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Allocation
  // ---------------------------------------------------------------------------

  async allocateStock(params: {
    organizationId: string;
    warehouseId: string;
    variantId: string;
    quantity: string;
    expiresAt?: Date | null;
    referenceType?: string;
    referenceId?: string;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ allocation: AllocationRow }> {
    const quantityNum = parseFloat(params.quantity);
    if (quantityNum <= 0) {
      throw PlatformError.validationFailed('Allocate quantity must be positive.', {
        details: { quantity: params.quantity },
      });
    }

    const idempotencyScope = `inventory:allocateStock:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { allocation: AllocationRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      const allocation = await this.allocateWithFIFO(
        tx,
        params.organizationId,
        params.warehouseId,
        params.variantId,
        params.quantity,
        {
          expiresAt: params.expiresAt,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          correlationId: params.idempotencyKey,
          actorId: params.principal.id,
        },
      );

      const response = { allocation };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  async releaseAllocation(params: {
    organizationId: string;
    allocationId: string;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ released: AllocationRow }> {
    const idempotencyScope = `inventory:releaseAllocation:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { released: AllocationRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      // Load allocation
      const allocation = await this.repository.findAllocationById(
        tx,
        params.organizationId,
        params.allocationId,
      );

      if (!allocation) {
        throw PlatformError.notFound(`Allocation ${params.allocationId} not found.`, {
          details: { allocationId: params.allocationId, organizationId: params.organizationId },
        });
      }

      if (allocation.status !== 'ACTIVE') {
        throw PlatformError.of(
          ERROR_CODES.ALLOCATION_INSUFFICIENT,
          `Allocation ${params.allocationId} is ${allocation.status}, not ACTIVE.`,
          { details: { allocationId: params.allocationId, status: allocation.status } },
        );
      }

      // Release: decrease allocated on stock position
      // Note: allocation amount is not tracked in items like reservations;
      // for now, find the stock position and decrease allocated
      const stockPos = await this.repository.findStockPositionById(
        tx,
        params.organizationId,
        allocation.stockPositionId,
      );

      if (stockPos) {
        // We need to know the allocated amount — check if there's a reference
        // In a full implementation, allocation items would track this.
        // For now, we release by marking the allocation as released and
        // relying on ledger entries to track the amount.
        // The allocated amount on the stock position needs to be decreased.
        // Since we don't have allocation items, we assume a 1:1 mapping
        // (one allocation per stock position adjustment).

        // Find the allocation's original quantity from ledger
        // For now, use the approach of reading the ALLOCATION ledger entry
        const ledgerEntries = await this.repository.listLedgerEntries(
          tx,
          params.organizationId,
          allocation.stockPositionId,
        );

        const allocationEntry = ledgerEntries.find(
          (e) => e.referenceType === 'ALLOCATION' && e.referenceId === allocation.id,
        );

        if (allocationEntry) {
          const allocateAmount = allocationEntry.quantityChange.replace('+', '');
          const newAllocated = this.decimalSubtract(stockPos.allocated, allocateAmount);
          const updated = await this.repository.updateStockPosition(
            tx,
            params.organizationId,
            stockPos.id,
            { allocated: newAllocated },
            stockPos.version,
          );

          if (!updated) {
            throw PlatformError.of(
              ERROR_CODES.RESOURCE_VERSION_CONFLICT,
              `Stock position ${stockPos.id} was modified concurrently.`,
              { details: { stockPositionId: stockPos.id, expectedVersion: stockPos.version } },
            );
          }

          // Ledger entry for deallocation
          await this.repository.createLedgerEntry(tx, {
            organizationId: params.organizationId,
            stockPositionId: stockPos.id,
            entryType: 'DEALLOCATION',
            quantityChange: allocateAmount,
            referenceType: 'ALLOCATION',
            referenceId: allocation.id,
          });
        }
      }

      // Update allocation status
      const updatedAllocation = await this.repository.updateAllocationStatus(
        tx,
        allocation.id,
        'RELEASED',
        allocation.version,
      );

      if (!updatedAllocation) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Allocation ${allocation.id} was modified concurrently.`,
          { details: { allocationId: allocation.id, expectedVersion: allocation.version } },
        );
      }

      // Outbox event
      await this.repository.createOutboxEvents(tx, [
        inventoryEvent(
          'inventory.allocation-released',
          params.organizationId,
          'Allocation',
          allocation.id,
          updatedAllocation.version,
          params.idempotencyKey,
          params.idempotencyKey,
          params.principal.id,
          { stockPositionId: allocation.stockPositionId },
        ),
      ]);

      const response = { released: updatedAllocation };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  async consumeAllocation(params: {
    organizationId: string;
    allocationId: string;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ consumed: AllocationRow }> {
    const idempotencyScope = `inventory:consumeAllocation:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { consumed: AllocationRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      // Load allocation
      const allocation = await this.repository.findAllocationById(
        tx,
        params.organizationId,
        params.allocationId,
      );

      if (!allocation) {
        throw PlatformError.notFound(`Allocation ${params.allocationId} not found.`, {
          details: { allocationId: params.allocationId, organizationId: params.organizationId },
        });
      }

      if (allocation.status !== 'ACTIVE') {
        throw PlatformError.of(
          ERROR_CODES.RESERVATION_ALREADY_CONSUMED,
          `Allocation ${params.allocationId} is ${allocation.status}, not ACTIVE.`,
          { details: { allocationId: allocation.id, status: allocation.status } },
        );
      }

      // Consume: decrease on_hand and allocated, consume FIFO layers
      const stockPos = await this.repository.findStockPositionById(
        tx,
        params.organizationId,
        allocation.stockPositionId,
      );

      if (stockPos) {
        // Find allocated amount from ledger
        const ledgerEntriesList = await this.repository.listLedgerEntries(
          tx,
          params.organizationId,
          allocation.stockPositionId,
        );

        const allocationEntry = ledgerEntriesList.find(
          (e) => e.referenceType === 'ALLOCATION' && e.referenceId === allocation.id,
        );

        if (allocationEntry) {
          const allocateAmount = allocationEntry.quantityChange.replace('+', '');

          // Consume FIFO layers
          await this.consumeFIFOLayers(tx, stockPos.id, params.organizationId, allocateAmount, {
            referenceType: 'ALLOCATION',
            referenceId: allocation.id,
            correlationId: params.idempotencyKey,
            actorId: params.principal.id,
          });

          // Update stock position: decrease on_hand and allocated
          const newOnHand = this.decimalSubtract(stockPos.onHand, allocateAmount);
          const newAllocated = this.decimalSubtract(stockPos.allocated, allocateAmount);
          const updated = await this.repository.updateStockPosition(
            tx,
            params.organizationId,
            stockPos.id,
            { onHand: newOnHand, allocated: newAllocated },
            stockPos.version,
          );

          if (!updated) {
            throw PlatformError.of(
              ERROR_CODES.RESOURCE_VERSION_CONFLICT,
              `Stock position ${stockPos.id} was modified concurrently.`,
              { details: { stockPositionId: stockPos.id, expectedVersion: stockPos.version } },
            );
          }

          // Ledger entry for consumption
          await this.repository.createLedgerEntry(tx, {
            organizationId: params.organizationId,
            stockPositionId: stockPos.id,
            entryType: 'CONSUMPTION',
            quantityChange: `-${allocateAmount}`,
            referenceType: 'ALLOCATION',
            referenceId: allocation.id,
          });
        }
      }

      // Update allocation status
      const updatedAllocation = await this.repository.updateAllocationStatus(
        tx,
        allocation.id,
        'CONSUMED',
        allocation.version,
      );

      if (!updatedAllocation) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Allocation ${allocation.id} was modified concurrently.`,
          { details: { allocationId: allocation.id, expectedVersion: allocation.version } },
        );
      }

      // Outbox event
      await this.repository.createOutboxEvents(tx, [
        inventoryEvent(
          'inventory.allocation-consumed',
          params.organizationId,
          'Allocation',
          allocation.id,
          updatedAllocation.version,
          params.idempotencyKey,
          params.idempotencyKey,
          params.principal.id,
          { stockPositionId: allocation.stockPositionId },
        ),
      ]);

      const response = { consumed: updatedAllocation };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Transfers
  // ---------------------------------------------------------------------------

  async createTransfer(params: {
    organizationId: string;
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    items: Array<{ variantId: string; quantity: string }>;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ transfer: StockTransferRow }> {
    if (params.sourceWarehouseId === params.destinationWarehouseId) {
      throw PlatformError.validationFailed('Source and destination warehouses must be different.', {
        details: {
          sourceWarehouseId: params.sourceWarehouseId,
          destinationWarehouseId: params.destinationWarehouseId,
        },
      });
    }

    if (params.items.length === 0) {
      throw PlatformError.validationFailed('Transfer must have at least one item.', {
        details: {},
      });
    }

    const idempotencyScope = `inventory:createTransfer:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { transfer: StockTransferRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      // Create transfer
      const transfer = await this.repository.createTransfer(tx, {
        organizationId: params.organizationId,
        sourceWarehouseId: params.sourceWarehouseId,
        destinationWarehouseId: params.destinationWarehouseId,
        status: 'DRAFT',
      });

      // Create transfer items
      for (const item of params.items) {
        const itemQuantityNum = parseFloat(item.quantity);
        if (itemQuantityNum <= 0) {
          throw PlatformError.validationFailed(
            `Transfer item quantity must be positive for variant ${item.variantId}.`,
            { details: { variantId: item.variantId, quantity: item.quantity } },
          );
        }

        await this.repository.createTransferItem(tx, {
          organizationId: params.organizationId,
          transferId: transfer.id,
          variantId: item.variantId,
          quantity: item.quantity,
        });
      }

      // Outbox event
      await this.repository.createOutboxEvents(tx, [
        inventoryEvent(
          'inventory.transfer-created',
          params.organizationId,
          'StockTransfer',
          transfer.id,
          transfer.version,
          params.idempotencyKey,
          params.idempotencyKey,
          params.principal.id,
          {
            sourceWarehouseId: params.sourceWarehouseId,
            destinationWarehouseId: params.destinationWarehouseId,
            itemCount: params.items.length,
          },
        ),
      ]);

      const response = { transfer };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  async dispatchTransfer(params: {
    organizationId: string;
    transferId: string;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ dispatched: StockTransferRow }> {
    const idempotencyScope = `inventory:dispatchTransfer:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { dispatched: StockTransferRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      const dispatched = await this.dispatchTransferInternal(
        tx,
        params.organizationId,
        params.transferId,
        {
          correlationId: params.idempotencyKey,
          actorId: params.principal.id,
        },
      );

      const response = { dispatched };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  async receiveTransfer(params: {
    organizationId: string;
    transferId: string;
    items: Array<{ transferItemId: string; receivedQuantity: string }>;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ received: StockTransferRow }> {
    const idempotencyScope = `inventory:receiveTransfer:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { received: StockTransferRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      const received = await this.receiveTransferInternal(
        tx,
        params.organizationId,
        params.transferId,
        params.items,
        {
          correlationId: params.idempotencyKey,
          actorId: params.principal.id,
        },
      );

      const response = { received };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Adjustments
  // ---------------------------------------------------------------------------

  async applyAdjustment(params: {
    organizationId: string;
    stockPositionId: string;
    adjustmentType: string;
    quantityChange: string;
    reason: string;
    approvedBy?: string | null;
    idempotencyKey: string;
    requestHash: string;
    principal: { id: string };
  }): Promise<{ adjustment: StockAdjustmentRow }> {
    const quantityChangeNum = parseFloat(params.quantityChange);
    if (quantityChangeNum === 0) {
      throw PlatformError.validationFailed('Quantity change must not be zero.', {
        details: { quantityChange: params.quantityChange },
      });
    }

    // Approval required for decreases
    if (
      (params.adjustmentType === 'DECREASE' || params.adjustmentType === 'CORRECTION') &&
      !params.approvedBy
    ) {
      throw PlatformError.of(
        ERROR_CODES.STOCK_ADJUSTMENT_APPROVAL_REQUIRED,
        'Stock decrease/correction adjustments require approval.',
        {
          details: {
            adjustmentType: params.adjustmentType,
            stockPositionId: params.stockPositionId,
          },
        },
      );
    }

    const idempotencyScope = `inventory:applyAdjustment:${params.organizationId}`;
    const result = await this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotencyKey(
        tx,
        params.idempotencyKey,
        params.requestHash,
        idempotencyScope,
      );

      if (claim.kind === 'existing') {
        if (claim.status === 'COMPLETED' && claim.responseJson) {
          return claim.responseJson as { adjustment: StockAdjustmentRow };
        }
        throw PlatformError.idempotencyConflict('Request is being processed.', {
          details: { idempotencyKey: params.idempotencyKey },
        });
      }

      // Load stock position
      const stockPos = await this.repository.findStockPositionById(
        tx,
        params.organizationId,
        params.stockPositionId,
      );

      if (!stockPos) {
        throw PlatformError.of(
          ERROR_CODES.INVENTORY_POSITION_NOT_FOUND,
          `Stock position ${params.stockPositionId} not found.`,
          {
            details: {
              stockPositionId: params.stockPositionId,
              organizationId: params.organizationId,
            },
          },
        );
      }

      // Apply adjustment to on_hand
      let newOnHand: string;
      if (params.adjustmentType === 'INCREASE') {
        newOnHand = this.decimalAdd(stockPos.onHand, params.quantityChange);
      } else {
        // DECREASE or CORRECTION
        newOnHand = this.decimalSubtract(stockPos.onHand, params.quantityChange);
      }

      // Validate on_hand >= 0
      if (parseFloat(newOnHand) < 0) {
        throw PlatformError.of(
          ERROR_CODES.INVENTORY_INSUFFICIENT,
          `Adjustment would result in negative on-hand (${newOnHand}).`,
          {
            details: {
              stockPositionId: stockPos.id,
              currentOnHand: stockPos.onHand,
              adjustmentType: params.adjustmentType,
              quantityChange: params.quantityChange,
            },
          },
        );
      }

      // Update stock position
      const updated = await this.repository.updateStockPosition(
        tx,
        params.organizationId,
        stockPos.id,
        { onHand: newOnHand },
        stockPos.version,
      );

      if (!updated) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Stock position ${stockPos.id} was modified concurrently.`,
          { details: { stockPositionId: stockPos.id, expectedVersion: stockPos.version } },
        );
      }

      // Create adjustment record
      const adjustment = await this.repository.createAdjustment(tx, {
        organizationId: params.organizationId,
        stockPositionId: stockPos.id,
        adjustmentType: params.adjustmentType,
        quantityBefore: stockPos.onHand,
        quantityAfter: newOnHand,
        reason: params.reason,
        approvedBy: params.approvedBy,
        referenceType: params.adjustmentType,
      });

      // Ledger entry
      const sign = params.adjustmentType === 'INCREASE' ? '+' : '-';
      await this.repository.createLedgerEntry(tx, {
        organizationId: params.organizationId,
        stockPositionId: stockPos.id,
        entryType: 'ADJUSTMENT',
        quantityChange: `${sign}${params.quantityChange}`,
        referenceType: 'ADJUSTMENT',
        referenceId: adjustment.id,
      });

      // Outbox event
      await this.repository.createOutboxEvents(tx, [
        inventoryEvent(
          'inventory.adjustment-applied',
          params.organizationId,
          'StockAdjustment',
          adjustment.id,
          1,
          params.idempotencyKey,
          params.idempotencyKey,
          params.principal.id,
          {
            stockPositionId: stockPos.id,
            adjustmentType: params.adjustmentType,
            quantityBefore: parseFloat(stockPos.onHand),
            quantityAfter: parseFloat(newOnHand),
          },
        ),
      ]);

      const response = { adjustment };
      await this.repository.recordIdempotencyOutcome(tx, claim.claimId, 'COMPLETED', response);

      return response;
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Query methods
  // ---------------------------------------------------------------------------

  async getStockPosition(
    organizationId: string,
    warehouseId: string,
    variantId: string,
  ): Promise<StockPositionRow | null> {
    return this.repository.findStockPosition(this.db, organizationId, warehouseId, variantId);
  }

  async getStockPositionById(
    organizationId: string,
    stockPositionId: string,
  ): Promise<StockPositionRow | null> {
    return this.repository.findStockPositionById(this.db, organizationId, stockPositionId);
  }

  async listStockPositions(
    organizationId: string,
    warehouseId?: string,
    limit?: number,
    offset?: number,
  ): Promise<StockPositionRow[]> {
    return this.repository.listStockPositions(this.db, organizationId, {
      warehouseId,
      limit,
      offset,
    });
  }

  async getFIFOLayers(organizationId: string, stockPositionId: string): Promise<FIFOLayerRow[]> {
    return this.repository.listFIFOLayers(this.db, organizationId, stockPositionId);
  }

  async getLedgerEntries(
    organizationId: string,
    stockPositionId: string,
    limit?: number,
    offset?: number,
  ): Promise<LedgerEntryRow[]> {
    return this.repository.listLedgerEntries(this.db, organizationId, stockPositionId, {
      limit,
      offset,
    });
  }

  async listReservations(
    organizationId: string,
    stockPositionId?: string,
  ): Promise<ReservationRow[]> {
    return this.repository.listReservations(this.db, organizationId, stockPositionId);
  }

  async listAllocations(
    organizationId: string,
    stockPositionId?: string,
  ): Promise<AllocationRow[]> {
    return this.repository.listAllocations(this.db, organizationId, stockPositionId);
  }

  async listTransfers(organizationId: string, status?: string): Promise<StockTransferRow[]> {
    return this.repository.listTransfers(this.db, organizationId, status);
  }

  async getTransfer(organizationId: string, transferId: string): Promise<StockTransferRow | null> {
    return this.repository.findTransferById(this.db, organizationId, transferId);
  }

  async listAdjustments(
    organizationId: string,
    stockPositionId?: string,
  ): Promise<StockAdjustmentRow[]> {
    return this.repository.listAdjustments(this.db, organizationId, stockPositionId);
  }

  // ---------------------------------------------------------------------------
  // Private FIFO helpers
  // ---------------------------------------------------------------------------

  /**
   * Consume FIFO layers oldest-first until quantityToConsume is satisfied.
   * Returns the total consumed and per-layer breakdown.
   *
   * CRITICAL: Layers must be locked with FOR UPDATE before calling this.
   */
  private async consumeFIFOLayers(
    tx: DbExecutor,
    stockPositionId: string,
    organizationId: string,
    quantityToConsume: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future FIFO audit context
    opts: {
      referenceType?: string;
      referenceId?: string;
      correlationId: string;
      actorId: string;
    },
  ): Promise<{ totalConsumed: string; layers: Array<{ layerId: string; consumed: string }> }> {
    const quantityNum = parseFloat(quantityToConsume);
    let remaining = quantityNum;
    const layerBreakdown: Array<{ layerId: string; consumed: string }> = [];

    // Lock oldest layers
    const layers = await this.repository.findOldestFIFOLayers(
      tx,
      organizationId,
      stockPositionId,
      100,
    );

    // Check total remaining
    let totalRemaining = 0;
    for (const layer of layers) {
      totalRemaining += parseFloat(layer.remainingQuantity);
    }

    if (totalRemaining < quantityNum) {
      throw PlatformError.of(
        ERROR_CODES.INVENTORY_INSUFFICIENT,
        `Insufficient FIFO layer quantity. Available: ${totalRemaining}, requested: ${quantityNum}.`,
        {
          details: {
            stockPositionId,
            availableInLayers: totalRemaining,
            requested: quantityNum,
          },
        },
      );
    }

    // Consume layers
    for (const layer of layers) {
      if (remaining <= 0) break;

      const layerRemaining = parseFloat(layer.remainingQuantity);
      const toConsumeFromLayer = Math.min(remaining, layerRemaining);
      const newRemaining = layerRemaining - toConsumeFromLayer;

      await this.repository.updateFIFOLayerRemaining(tx, layer.id, String(newRemaining));

      remaining -= toConsumeFromLayer;

      layerBreakdown.push({
        layerId: layer.id,
        consumed: String(toConsumeFromLayer),
      });
    }

    return {
      totalConsumed: String(quantityNum),
      layers: layerBreakdown,
    };
  }

  /**
   * Reserve stock with FIFO validation: increase reserved, validate layers.
   */
  private async reserveWithFIFO(
    tx: DbExecutor,
    organizationId: string,
    warehouseId: string,
    variantId: string,
    quantity: string,
    opts: {
      expiresAt?: Date | null;
      referenceType?: string;
      referenceId?: string;
      correlationId: string;
      actorId: string;
    },
  ): Promise<ReservationRow> {
    const quantityNum = parseFloat(quantity);

    // Find or create stock position
    let stockPos = await this.repository.findStockPosition(
      tx,
      organizationId,
      warehouseId,
      variantId,
    );

    if (!stockPos) {
      stockPos = await this.repository.createStockPosition(tx, {
        organizationId,
        warehouseId,
        variantId,
      });

      await this.repository.createOutboxEvents(tx, [
        inventoryEvent(
          'inventory.stock-position-created',
          organizationId,
          'StockPosition',
          stockPos.id,
          stockPos.version,
          opts.correlationId,
          opts.correlationId,
          opts.actorId,
          { warehouseId, variantId, onHand: '0' },
        ),
      ]);
    }

    // Check available >= quantity
    const available =
      parseFloat(stockPos.onHand) - parseFloat(stockPos.reserved) - parseFloat(stockPos.allocated);

    if (available < quantityNum) {
      throw PlatformError.of(
        ERROR_CODES.INVENTORY_INSUFFICIENT,
        `Insufficient available stock. Available: ${available}, requested: ${quantityNum}.`,
        {
          details: {
            stockPositionId: stockPos.id,
            available,
            requested: quantityNum,
          },
        },
      );
    }

    // Validate FIFO layers have enough total remaining (consistency check)
    const layers = await this.repository.findOldestFIFOLayers(tx, organizationId, stockPos.id, 100);
    let totalRemaining = 0;
    for (const layer of layers) {
      totalRemaining += parseFloat(layer.remainingQuantity);
    }

    if (totalRemaining < quantityNum) {
      throw PlatformError.of(
        ERROR_CODES.INVENTORY_INSUFFICIENT,
        `FIFO layer inconsistency. Layer total: ${totalRemaining}, available: ${available}.`,
        {
          details: {
            stockPositionId: stockPos.id,
            layerTotal: totalRemaining,
            available,
          },
        },
      );
    }

    // Increase reserved
    const newReserved = this.decimalAdd(stockPos.reserved, quantity);
    const updated = await this.repository.updateStockPosition(
      tx,
      organizationId,
      stockPos.id,
      { reserved: newReserved },
      stockPos.version,
    );

    if (!updated) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `Stock position ${stockPos.id} was modified concurrently.`,
        { details: { stockPositionId: stockPos.id, expectedVersion: stockPos.version } },
      );
    }

    // Create reservation
    const reservation = await this.repository.createReservation(tx, {
      organizationId,
      stockPositionId: stockPos.id,
      expiresAt: opts.expiresAt,
      referenceType: opts.referenceType,
      referenceId: opts.referenceId,
    });

    // Create reservation item (needed by releaseReservation/consumeReservation)
    await this.repository.createReservationItem(tx, {
      organizationId,
      reservationId: reservation.id,
      variantId,
      quantity,
    });

    // Ledger entry
    await this.repository.createLedgerEntry(tx, {
      organizationId,
      stockPositionId: stockPos.id,
      entryType: 'RESERVATION',
      quantityChange: quantity,
      referenceType: 'RESERVATION',
      referenceId: reservation.id,
    });

    // Outbox event
    await this.repository.createOutboxEvents(tx, [
      inventoryEvent(
        'inventory.stock-reserved',
        organizationId,
        'StockPosition',
        stockPos.id,
        updated.version,
        opts.correlationId,
        opts.correlationId,
        opts.actorId,
        {
          warehouseId,
          variantId,
          quantity: quantityNum,
          reservationId: reservation.id,
        },
      ),
    ]);

    return reservation;
  }

  /**
   * Allocate stock with FIFO validation: increase allocated, validate layers.
   */
  private async allocateWithFIFO(
    tx: DbExecutor,
    organizationId: string,
    warehouseId: string,
    variantId: string,
    quantity: string,
    opts: {
      expiresAt?: Date | null;
      referenceType?: string;
      referenceId?: string;
      correlationId: string;
      actorId: string;
    },
  ): Promise<AllocationRow> {
    const quantityNum = parseFloat(quantity);

    // Find or create stock position
    let stockPos = await this.repository.findStockPosition(
      tx,
      organizationId,
      warehouseId,
      variantId,
    );

    if (!stockPos) {
      stockPos = await this.repository.createStockPosition(tx, {
        organizationId,
        warehouseId,
        variantId,
      });

      await this.repository.createOutboxEvents(tx, [
        inventoryEvent(
          'inventory.stock-position-created',
          organizationId,
          'StockPosition',
          stockPos.id,
          stockPos.version,
          opts.correlationId,
          opts.correlationId,
          opts.actorId,
          { warehouseId, variantId, onHand: '0' },
        ),
      ]);
    }

    // Check available >= quantity
    const available =
      parseFloat(stockPos.onHand) - parseFloat(stockPos.reserved) - parseFloat(stockPos.allocated);

    if (available < quantityNum) {
      throw PlatformError.of(
        ERROR_CODES.ALLOCATION_INSUFFICIENT,
        `Insufficient available stock for allocation. Available: ${available}, requested: ${quantityNum}.`,
        {
          details: {
            stockPositionId: stockPos.id,
            available,
            requested: quantityNum,
          },
        },
      );
    }

    // Validate FIFO layers
    const layers = await this.repository.findOldestFIFOLayers(tx, organizationId, stockPos.id, 100);
    let totalRemaining = 0;
    for (const layer of layers) {
      totalRemaining += parseFloat(layer.remainingQuantity);
    }

    if (totalRemaining < quantityNum) {
      throw PlatformError.of(
        ERROR_CODES.ALLOCATION_INSUFFICIENT,
        `FIFO layer inconsistency for allocation. Layer total: ${totalRemaining}, available: ${available}.`,
        {
          details: {
            stockPositionId: stockPos.id,
            layerTotal: totalRemaining,
            available,
          },
        },
      );
    }

    // Increase allocated
    const newAllocated = this.decimalAdd(stockPos.allocated, quantity);
    const updated = await this.repository.updateStockPosition(
      tx,
      organizationId,
      stockPos.id,
      { allocated: newAllocated },
      stockPos.version,
    );

    if (!updated) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `Stock position ${stockPos.id} was modified concurrently.`,
        { details: { stockPositionId: stockPos.id, expectedVersion: stockPos.version } },
      );
    }

    // Create allocation
    const allocation = await this.repository.createAllocation(tx, {
      organizationId,
      stockPositionId: stockPos.id,
      expiresAt: opts.expiresAt,
      referenceType: opts.referenceType,
      referenceId: opts.referenceId,
    });

    // Ledger entry
    await this.repository.createLedgerEntry(tx, {
      organizationId,
      stockPositionId: stockPos.id,
      entryType: 'ALLOCATION',
      quantityChange: quantity,
      referenceType: 'ALLOCATION',
      referenceId: allocation.id,
    });

    // Outbox event
    await this.repository.createOutboxEvents(tx, [
      inventoryEvent(
        'inventory.allocation-created',
        organizationId,
        'Allocation',
        allocation.id,
        allocation.version,
        opts.correlationId,
        opts.correlationId,
        opts.actorId,
        {
          stockPositionId: stockPos.id,
          quantity: quantityNum,
        },
      ),
    ]);

    return allocation;
  }

  /**
   * Consume stock with FIFO: decrease on_hand, consume layers, create ledger.
   */
  private async consumeStockWithFIFO(
    tx: DbExecutor,
    organizationId: string,
    warehouseId: string,
    variantId: string,
    quantity: string,
    opts: {
      referenceType?: string;
      referenceId?: string;
      correlationId: string;
      actorId: string;
    },
  ): Promise<StockPositionRow> {
    const quantityNum = parseFloat(quantity);

    // Find stock position (must exist for consumption)
    const stockPos = await this.repository.findStockPosition(
      tx,
      organizationId,
      warehouseId,
      variantId,
    );

    if (!stockPos) {
      throw PlatformError.of(
        ERROR_CODES.INVENTORY_POSITION_NOT_FOUND,
        `Stock position not found for (${warehouseId}, ${variantId}).`,
        {
          details: { organizationId, warehouseId, variantId },
        },
      );
    }

    // Check on_hand >= quantity
    if (parseFloat(stockPos.onHand) < quantityNum) {
      throw PlatformError.of(
        ERROR_CODES.INVENTORY_INSUFFICIENT,
        `Insufficient stock. On-hand: ${stockPos.onHand}, requested: ${quantityNum}.`,
        {
          details: {
            stockPositionId: stockPos.id,
            onHand: stockPos.onHand,
            requested: quantityNum,
          },
        },
      );
    }

    // Consume FIFO layers
    await this.consumeFIFOLayers(tx, stockPos.id, organizationId, quantity, {
      referenceType: opts.referenceType,
      referenceId: opts.referenceId,
      correlationId: opts.correlationId,
      actorId: opts.actorId,
    });

    // Decrease on_hand
    const newOnHand = this.decimalSubtract(stockPos.onHand, quantity);
    const updated = await this.repository.updateStockPosition(
      tx,
      organizationId,
      stockPos.id,
      { onHand: newOnHand },
      stockPos.version,
    );

    if (!updated) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `Stock position ${stockPos.id} was modified concurrently.`,
        { details: { stockPositionId: stockPos.id, expectedVersion: stockPos.version } },
      );
    }

    // Ledger entry
    await this.repository.createLedgerEntry(tx, {
      organizationId,
      stockPositionId: stockPos.id,
      entryType: 'CONSUMPTION',
      quantityChange: `-${quantity}`,
      referenceType: opts.referenceType,
      referenceId: opts.referenceId,
    });

    // Outbox event
    await this.repository.createOutboxEvents(tx, [
      inventoryEvent(
        'inventory.stock-consumed',
        organizationId,
        'StockPosition',
        stockPos.id,
        updated.version,
        opts.correlationId,
        opts.correlationId,
        opts.actorId,
        {
          warehouseId,
          variantId,
          quantity: quantityNum,
        },
      ),
    ]);

    return updated;
  }

  /**
   * Dispatch a transfer: decrease source stock, move to IN_TRANSIT.
   */
  private async dispatchTransferInternal(
    tx: DbExecutor,
    organizationId: string,
    transferId: string,
    opts: {
      correlationId: string;
      actorId: string;
    },
  ): Promise<StockTransferRow> {
    // Load transfer
    const transfer = await this.repository.findTransferById(tx, organizationId, transferId);

    if (!transfer) {
      throw PlatformError.notFound(`Transfer ${transferId} not found.`, {
        details: { transferId, organizationId },
      });
    }

    if (transfer.status !== 'DRAFT') {
      throw PlatformError.of(
        ERROR_CODES.TRANSFER_INVALID_STATE,
        `Transfer ${transferId} is ${transfer.status}, must be DRAFT to dispatch.`,
        { details: { transferId, status: transfer.status } },
      );
    }

    // Load transfer items
    const items = await this.repository.findTransferItems(tx, transfer.id);

    if (items.length === 0) {
      throw PlatformError.validationFailed(`Transfer ${transferId} has no items.`, {
        details: { transferId },
      });
    }

    // For each item: lock source stock position, check available, decrease on_hand
    for (const item of items) {
      const stockPos = await this.repository.findStockPosition(
        tx,
        organizationId,
        transfer.sourceWarehouseId,
        item.variantId,
      );

      if (!stockPos) {
        throw PlatformError.of(
          ERROR_CODES.INVENTORY_POSITION_NOT_FOUND,
          `Source stock position not found for variant ${item.variantId}.`,
          {
            details: {
              transferId,
              variantId: item.variantId,
              warehouseId: transfer.sourceWarehouseId,
            },
          },
        );
      }

      const itemQuantityNum = parseFloat(item.quantity);
      const available =
        parseFloat(stockPos.onHand) -
        parseFloat(stockPos.reserved) -
        parseFloat(stockPos.allocated);

      if (available < itemQuantityNum) {
        throw PlatformError.of(
          ERROR_CODES.INVENTORY_INSUFFICIENT,
          `Insufficient stock for transfer dispatch. Variant ${item.variantId}: available ${available}, requested ${itemQuantityNum}.`,
          {
            details: {
              transferId,
              variantId: item.variantId,
              stockPositionId: stockPos.id,
              available,
              requested: itemQuantityNum,
            },
          },
        );
      }

      // Decrease on_hand (transfer uses available directly, not reserved/allocated)
      const newOnHand = this.decimalSubtract(stockPos.onHand, item.quantity);
      const updated = await this.repository.updateStockPosition(
        tx,
        organizationId,
        stockPos.id,
        { onHand: newOnHand },
        stockPos.version,
      );

      if (!updated) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Stock position ${stockPos.id} was modified concurrently.`,
          { details: { stockPositionId: stockPos.id, expectedVersion: stockPos.version } },
        );
      }

      // Ledger entry (TRANSFER_OUT)
      await this.repository.createLedgerEntry(tx, {
        organizationId,
        stockPositionId: stockPos.id,
        entryType: 'TRANSFER_OUT',
        quantityChange: `-${item.quantity}`,
        referenceType: 'TRANSFER',
        referenceId: transfer.id,
      });
    }

    // Update transfer status to DISPATCHED
    const updatedTransfer = await this.repository.updateTransferStatus(
      tx,
      transfer.id,
      'DISPATCHED',
      { dispatchedAt: new Date() },
      transfer.version,
    );

    if (!updatedTransfer) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `Transfer ${transfer.id} was modified concurrently.`,
        { details: { transferId: transfer.id, expectedVersion: transfer.version } },
      );
    }

    // Outbox event
    await this.repository.createOutboxEvents(tx, [
      inventoryEvent(
        'inventory.transfer-dispatched',
        organizationId,
        'StockTransfer',
        transfer.id,
        updatedTransfer.version,
        opts.correlationId,
        opts.correlationId,
        opts.actorId,
        {
          sourceWarehouseId: transfer.sourceWarehouseId,
          destinationWarehouseId: transfer.destinationWarehouseId,
        },
      ),
    ]);

    return updatedTransfer;
  }

  /**
   * Receive a transfer: increase destination stock, create FIFO layers.
   */
  private async receiveTransferInternal(
    tx: DbExecutor,
    organizationId: string,
    transferId: string,
    items: Array<{ transferItemId: string; receivedQuantity: string }>,
    opts: {
      correlationId: string;
      actorId: string;
    },
  ): Promise<StockTransferRow> {
    // Load transfer
    const transfer = await this.repository.findTransferById(tx, organizationId, transferId);

    if (!transfer) {
      throw PlatformError.notFound(`Transfer ${transferId} not found.`, {
        details: { transferId, organizationId },
      });
    }

    if (transfer.status !== 'IN_TRANSIT' && transfer.status !== 'DISPATCHED') {
      throw PlatformError.of(
        ERROR_CODES.TRANSFER_INVALID_STATE,
        `Transfer ${transferId} is ${transfer.status}, must be IN_TRANSIT or DISPATCHED to receive.`,
        { details: { transferId, status: transfer.status } },
      );
    }

    // Load all transfer items to validate
    const allTransferItems = await this.repository.findTransferItems(tx, transfer.id);

    for (const receivedItem of items) {
      const transferItem = allTransferItems.find((ti) => ti.id === receivedItem.transferItemId);
      if (!transferItem) {
        throw PlatformError.notFound(
          `Transfer item ${receivedItem.transferItemId} not found in transfer ${transferId}.`,
          { details: { transferItemId: receivedItem.transferItemId, transferId } },
        );
      }

      const receivedQty = parseFloat(receivedItem.receivedQuantity);
      if (receivedQty < 0) {
        throw PlatformError.validationFailed('Received quantity cannot be negative.', {
          details: {
            transferItemId: receivedItem.transferItemId,
            receivedQuantity: receivedItem.receivedQuantity,
          },
        });
      }

      // Update transfer item's received quantity
      await this.repository.updateTransferItemReceived(
        tx,
        receivedItem.transferItemId,
        receivedItem.receivedQuantity,
      );

      // Only create stock at destination if received quantity > 0
      if (receivedQty > 0) {
        // Find or create destination stock position
        let destStockPos = await this.repository.findStockPosition(
          tx,
          organizationId,
          transfer.destinationWarehouseId,
          transferItem.variantId,
        );

        if (!destStockPos) {
          destStockPos = await this.repository.createStockPosition(tx, {
            organizationId,
            warehouseId: transfer.destinationWarehouseId,
            variantId: transferItem.variantId,
            onHand: receivedItem.receivedQuantity,
          });

          await this.repository.createOutboxEvents(tx, [
            inventoryEvent(
              'inventory.stock-position-created',
              organizationId,
              'StockPosition',
              destStockPos.id,
              destStockPos.version,
              opts.correlationId,
              opts.correlationId,
              opts.actorId,
              {
                warehouseId: transfer.destinationWarehouseId,
                variantId: transferItem.variantId,
                onHand: receivedItem.receivedQuantity,
              },
            ),
          ]);
        } else {
          // Increase on_hand
          const newOnHand = this.decimalAdd(destStockPos.onHand, receivedItem.receivedQuantity);
          const updated = await this.repository.updateStockPosition(
            tx,
            organizationId,
            destStockPos.id,
            { onHand: newOnHand },
            destStockPos.version,
          );

          if (!updated) {
            throw PlatformError.of(
              ERROR_CODES.RESOURCE_VERSION_CONFLICT,
              `Stock position ${destStockPos.id} was modified concurrently.`,
              {
                details: {
                  stockPositionId: destStockPos.id,
                  expectedVersion: destStockPos.version,
                },
              },
            );
          }

          destStockPos = updated;
        }

        // Create or update FIFO layer for the received stock
        await this.repository.createFIFOLayer(tx, {
          organizationId,
          stockPositionId: destStockPos.id,
          receivedAt: new Date(),
          quantity: receivedItem.receivedQuantity,
          remainingQuantity: receivedItem.receivedQuantity,
          unitCost: '0', // Transfer in doesn't carry cost; cost reconciliation is separate
        });

        // Ledger entry (TRANSFER_IN)
        await this.repository.createLedgerEntry(tx, {
          organizationId,
          stockPositionId: destStockPos.id,
          entryType: 'TRANSFER_IN',
          quantityChange: receivedItem.receivedQuantity,
          referenceType: 'TRANSFER',
          referenceId: transfer.id,
        });
      }
    }

    // Update transfer status to RECEIVED
    const updatedTransfer = await this.repository.updateTransferStatus(
      tx,
      transfer.id,
      'RECEIVED',
      { receivedAt: new Date() },
      transfer.version,
    );

    if (!updatedTransfer) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `Transfer ${transfer.id} was modified concurrently.`,
        { details: { transferId: transfer.id, expectedVersion: transfer.version } },
      );
    }

    // Outbox event
    await this.repository.createOutboxEvents(tx, [
      inventoryEvent(
        'inventory.transfer-received',
        organizationId,
        'StockTransfer',
        transfer.id,
        updatedTransfer.version,
        opts.correlationId,
        opts.correlationId,
        opts.actorId,
        {
          destinationWarehouseId: transfer.destinationWarehouseId,
        },
      ),
    ]);

    return updatedTransfer;
  }

  // ---------------------------------------------------------------------------
  // Decimal arithmetic helpers (string-based, no floating point errors)
  // ---------------------------------------------------------------------------

  /** Add two decimal strings and return a decimal string. */
  private decimalAdd(a: string, b: string): string {
    return String(parseFloat(a) + parseFloat(b));
  }

  /** Subtract b from a (decimal strings) and return a decimal string. */
  private decimalSubtract(a: string, b: string): string {
    return String(parseFloat(a) - parseFloat(b));
  }
}
