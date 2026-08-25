import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { OrganizationContractProvider } from './application/organization-contracts.provider';
import { OrganizationService } from './application/organization.service';
import { OrganizationProvisioningService } from './application/organization-provisioning.service';
import { ORGANIZATION_CONTRACTS, ORGANIZATION_PROVISIONING } from './contracts';
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
    OrganizationProvisioningService,
    OrganizationContractProvider,
    {
      provide: ORGANIZATION_CONTRACTS,
      useExisting: OrganizationContractProvider,
    },
    { provide: ORGANIZATION_PROVISIONING, useExisting: OrganizationProvisioningService },
  ],
  exports: [ORGANIZATION_CONTRACTS, ORGANIZATION_PROVISIONING],
})
export class OrganizationModule {}
