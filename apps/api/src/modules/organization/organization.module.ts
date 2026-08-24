import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { OrganizationContractProvider } from './application/organization-contracts.provider';
import { OrganizationService } from './application/organization.service';
import { ORGANIZATION_CONTRACTS } from './contracts';
import { OrganizationRepository } from './infrastructure/organization.repository';

/**
 * Nest wiring of the Organization bounded context.
 *
 * No controllers yet: the HTTP/API layer arrives in a later M1 task. Other
 * context modules consume the exported {@link ORGANIZATION_CONTRACTS} provider
 * (docs/architecture/60-module-contracts.md) — never this module's
 * repository or tables.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    OrganizationRepository,
    OrganizationService,
    {
      provide: ORGANIZATION_CONTRACTS,
      useClass: OrganizationContractProvider,
    },
  ],
  exports: [ORGANIZATION_CONTRACTS],
})
export class OrganizationModule {}
