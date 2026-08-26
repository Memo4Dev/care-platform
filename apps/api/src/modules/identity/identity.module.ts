import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { OrganizationModule } from '../organization/organization.module';
import { AuthorizationService } from './application/authorization.service';
import { IdentityContractProvider } from './application/identity-contracts.provider';
import { IdentityProvisioningService } from './application/identity-provisioning.service';
import { IdentityService } from './application/identity.service';
import { IDENTITY_CONTRACTS } from './contracts';
import { IDENTITY_PROVISIONING } from './provisioning.contracts';
import { AuthorizationQueryRepository } from './infrastructure/authorization.query-repository';
import { RoleRepository } from './infrastructure/role.repository';
import { UserRepository } from './infrastructure/user.repository';

/**
 * Nest wiring of the Identity & Access bounded context.
 *
 * No controllers/auth-guards yet: the HTTP/API layer arrives in M1-009. Other
 * context modules consume the exported {@link IDENTITY_CONTRACTS} provider
 * (docs/architecture/60-module-contracts.md "Identity & Access": Authorize,
 * GetEffectivePermissions; ValidatePOSDevice follows with M8) — never this
 * module's repositories or tables. Tenant Provisioning alone receives the
 * separately exported IDENTITY_PROVISIONING token for trusted bootstrap.
 */
@Module({
  imports: [DatabaseModule, OrganizationModule],
  providers: [
    UserRepository,
    RoleRepository,
    AuthorizationQueryRepository,
    IdentityService,
    IdentityProvisioningService,
    AuthorizationService,
    {
      provide: IDENTITY_CONTRACTS,
      useClass: IdentityContractProvider,
    },
    { provide: IDENTITY_PROVISIONING, useExisting: IdentityProvisioningService },
  ],
  exports: [IDENTITY_CONTRACTS, IDENTITY_PROVISIONING],
})
export class IdentityModule {}
