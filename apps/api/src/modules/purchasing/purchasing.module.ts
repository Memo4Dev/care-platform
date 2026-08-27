import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasingContractProvider } from './application/purchasing-contracts.provider';
import { PurchasingService } from './application/purchasing.service';
import { PURCHASING_CONTRACTS } from './contracts';
import { PurchasingRepository } from './infrastructure/purchasing.repository';

/**
 * Nest wiring of the Purchasing bounded context.
 *
 * Other context modules consume the exported {@link PURCHASING_CONTRACTS}
 * provider (docs/architecture/60-module-contracts.md) — never this module's
 * repository or tables.
 *
 * Imports {@link InventoryModule} for the {@link INVENTORY_CONTRACTS} token
 * used by {@link PurchasingService} to call Inventory.receiveStock on GR
 * confirmation (cross-context contract call, never direct table mutation).
 *
 * The HTTP controller is registered in {@link ApiModule}.
 */
@Module({
  imports: [DatabaseModule, InventoryModule],
  providers: [
    PurchasingRepository,
    PurchasingService,
    PurchasingContractProvider,
    {
      provide: PURCHASING_CONTRACTS,
      useExisting: PurchasingContractProvider,
    },
  ],
  exports: [PURCHASING_CONTRACTS, PurchasingService, PurchasingRepository],
})
export class PurchasingModule {}
