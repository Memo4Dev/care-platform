import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { OrganizationModule } from '../organization/organization.module';
import { InventoryContractProvider } from './application/inventory-contracts.provider';
import { InventoryService } from './application/inventory.service';
import { INVENTORY_CONTRACTS, INVENTORY_MUTATION_CONTRACTS } from './contracts';
import { InventoryRepository } from './infrastructure/inventory.repository';

/**
 * Nest wiring of the Inventory bounded context.
 *
 * Other context modules consume the exported {@link INVENTORY_CONTRACTS}
 * provider (docs/architecture/60-module-contracts.md) — never this module's
 * repository or tables.
 *
 * The HTTP controller is registered in {@link ApiModule}.
 */
@Module({
  imports: [DatabaseModule, OrganizationModule],
  providers: [
    InventoryRepository,
    InventoryService,
    InventoryContractProvider,
    {
      provide: INVENTORY_CONTRACTS,
      useExisting: InventoryContractProvider,
    },
    {
      provide: INVENTORY_MUTATION_CONTRACTS,
      useExisting: InventoryContractProvider,
    },
  ],
  exports: [INVENTORY_CONTRACTS, INVENTORY_MUTATION_CONTRACTS, InventoryService],
})
export class InventoryModule {}
