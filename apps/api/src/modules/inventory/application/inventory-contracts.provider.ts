import { Inject, Injectable } from '@nestjs/common';
import { type DatabaseClient } from '@commerce-platform/database';

import { DATABASE } from '../../database/database.tokens';
import {
  type AvailabilityView,
  type CartReservationStateResult,
  type CheckCartReservationInput,
  type CreateCartReservationInput,
  type CreateCartReservationResult,
  type InventoryContracts,
  type ReceiveStockInput,
  type ReleaseCartReservationInput,
} from '../contracts';
import { InventoryRepository } from '../infrastructure/inventory.repository';
import { inventoryEvent } from '../infrastructure/event-envelope';
import { InventoryService } from './inventory.service';
import {
  addInventoryQuantities,
  normalizeInventoryQuantity,
  subtractInventoryQuantities,
} from './inventory-quantity';

/**
 * Implementation of the Inventory module contract.
 *
 * Reads query projections directly (SELECT-only) for cheap hot paths.
 * The `receiveStock` command delegates to the internal receipt logic
 * used by the full InventoryService, keeping the same transactional
 * guarantees. All access is organizationId-scoped.
 */
@Injectable()
export class InventoryContractProvider implements InventoryContracts {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(InventoryRepository) private readonly repository: InventoryRepository,
    @Inject(InventoryService) private readonly service: InventoryService,
  ) {}

  async getAvailability(
    organizationId: string,
    warehouseId: string,
    variantId: string,
  ): Promise<AvailabilityView | null> {
    const pos = await this.repository.findStockPosition(
      this.db,
      organizationId,
      warehouseId,
      variantId,
    );

    if (!pos) return null;

    const onHand = normalizeInventoryQuantity(pos.onHand, { allowZero: true });
    const reserved = normalizeInventoryQuantity(pos.reserved, { allowZero: true });
    const allocated = normalizeInventoryQuantity(pos.allocated, { allowZero: true });
    const available = subtractInventoryQuantities(
      subtractInventoryQuantities(onHand, reserved),
      allocated,
    );

    return {
      stockPositionId: pos.id,
      organizationId: pos.organizationId,
      warehouseId: pos.warehouseId,
      variantId: pos.variantId,
      onHand,
      reserved,
      allocated,
      available,
    };
  }

  async receiveStock(input: ReceiveStockInput): Promise<{ stockPositionId: string }> {
    const quantity = normalizeInventoryQuantity(input.quantity);
    const result = await this.db.transaction(async (tx) => {
      // Find or create stock position
      let stockPos = await this.repository.findStockPosition(
        tx,
        input.organizationId,
        input.warehouseId,
        input.variantId,
      );

      if (!stockPos) {
        stockPos = await this.repository.createStockPosition(tx, {
          organizationId: input.organizationId,
          warehouseId: input.warehouseId,
          variantId: input.variantId,
          onHand: quantity,
        });
      } else {
        const newOnHand = addInventoryQuantities(stockPos.onHand, quantity);
        const updated = await this.repository.updateStockPosition(
          tx,
          input.organizationId,
          stockPos.id,
          { onHand: newOnHand },
          stockPos.version,
        );

        if (!updated) {
          throw new Error(
            `Stock position ${stockPos.id} was modified concurrently during contract receiveStock.`,
          );
        }
        stockPos = updated;
      }

      // Create FIFO layer
      const fifoLayer = await this.repository.createFIFOLayer(tx, {
        organizationId: input.organizationId,
        stockPositionId: stockPos.id,
        receivedAt: new Date(),
        quantity,
        remainingQuantity: quantity,
        unitCost: input.unitCost,
      });

      // Ledger entry
      await this.repository.createLedgerEntry(tx, {
        organizationId: input.organizationId,
        stockPositionId: stockPos.id,
        entryType: 'RECEIPT',
        quantityChange: quantity,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      });

      // Outbox event
      await this.repository.createOutboxEvents(tx, [
        inventoryEvent(
          'inventory.stock-received',
          input.organizationId,
          'StockPosition',
          stockPos.id,
          stockPos.version,
          fifoLayer.id,
          fifoLayer.id,
          'contract',
          {
            warehouseId: input.warehouseId,
            variantId: input.variantId,
            quantity: parseFloat(input.quantity),
            unitCost: parseFloat(input.unitCost),
            fifoLayerId: fifoLayer.id,
          },
        ),
      ]);

      return { stockPositionId: stockPos.id };
    });

    return result;
  }

  async createCartReservation(
    input: CreateCartReservationInput,
  ): Promise<CreateCartReservationResult> {
    return this.service.createCartReservation(input);
  }

  async releaseCartReservation(
    input: ReleaseCartReservationInput,
  ): Promise<CartReservationStateResult> {
    return this.service.releaseCartReservation(input);
  }

  async checkCartReservation(
    input: CheckCartReservationInput,
  ): Promise<CartReservationStateResult> {
    return this.service.checkCartReservation(input);
  }
}
