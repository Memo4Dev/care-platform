import { Inject, Injectable } from '@nestjs/common';
import { type DatabaseClient } from '@commerce-platform/database';

import { DATABASE } from '../../database/database.tokens';
import { type AvailabilityView, type InventoryContracts } from '../contracts';
import { InventoryRepository } from '../infrastructure/inventory.repository';

/**
 * Read-model implementation of the Inventory module contract.
 *
 * Deliberately queries projections directly (SELECT-only) instead of loading
 * aggregates: contract reads must stay cheap for hot paths such as POS
 * availability checks and checkout flows. All access is organizationId-scoped.
 */
@Injectable()
export class InventoryContractProvider implements InventoryContracts {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    private readonly repository: InventoryRepository,
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

    const onHand = parseFloat(pos.onHand);
    const reserved = parseFloat(pos.reserved);
    const allocated = parseFloat(pos.allocated);
    const available = onHand - reserved - allocated;

    return {
      stockPositionId: pos.id,
      organizationId: pos.organizationId,
      warehouseId: pos.warehouseId,
      variantId: pos.variantId,
      onHand: pos.onHand,
      reserved: pos.reserved,
      allocated: pos.allocated,
      available: String(available >= 0 ? available : 0),
    };
  }
}
