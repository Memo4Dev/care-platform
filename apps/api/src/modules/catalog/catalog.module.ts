import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { CatalogContractProvider } from './application/catalog-contracts.provider';
import { CatalogService } from './application/catalog.service';
import { CATALOG_CONTRACTS } from './contracts';
import { CatalogRepository } from './infrastructure/catalog.repository';

/**
 * Nest wiring of the Catalog bounded context.
 *
 * Other context modules consume the exported {@link CATALOG_CONTRACTS}
 * provider (docs/architecture/60-module-contracts.md) — never this module's
 * repository or tables.
 *
 * The HTTP controller is registered in {@link ApiModule} (same pattern as
 * TenantAdminController in the Organization context).
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    CatalogRepository,
    CatalogService,
    CatalogContractProvider,
    {
      provide: CATALOG_CONTRACTS,
      useExisting: CatalogContractProvider,
    },
  ],
  exports: [CATALOG_CONTRACTS, CatalogService, CatalogRepository],
})
export class CatalogModule {}
