import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ProvisioningExecutionModule } from '../../common/provisioning-execution/provisioning-execution.module';
import { PlatformService } from './application/platform.service';
import { PlatformAdminMutationAdapter } from './application/platform-admin-mutation.adapter';
import {
  DatabasePlatformAuthorizationProvider,
  PLATFORM_AUTHORIZATION,
} from './application/platform-authorization.provider';
import { PLATFORM_PROVISIONING } from './application/platform-provisioning.contract';
import { PlatformProvisioningService } from './application/platform-provisioning.service';
import {
  DatabasePlatformPrincipalResolver,
  FixedProvisioningSystemPrincipalProvider,
  PLATFORM_PRINCIPAL_RESOLVER,
  PROVISIONING_SYSTEM_PRINCIPAL,
} from './application/authenticated-principal.provider';
import { PlatformTenantRepository } from './infrastructure/platform-tenant.repository';
import {
  PLATFORM_REGISTRATION_RESOLVER,
  UnavailablePlatformRegistrationResolver,
} from './application/platform-registration.contract';
@Module({
  imports: [DatabaseModule, ProvisioningExecutionModule],
  providers: [
    PlatformTenantRepository,
    PlatformService,
    PlatformAdminMutationAdapter,
    PlatformProvisioningService,
    { provide: PLATFORM_AUTHORIZATION, useClass: DatabasePlatformAuthorizationProvider },
    { provide: PLATFORM_PRINCIPAL_RESOLVER, useClass: DatabasePlatformPrincipalResolver },
    { provide: PROVISIONING_SYSTEM_PRINCIPAL, useClass: FixedProvisioningSystemPrincipalProvider },
    { provide: PLATFORM_PROVISIONING, useExisting: PlatformProvisioningService },
    { provide: PLATFORM_REGISTRATION_RESOLVER, useClass: UnavailablePlatformRegistrationResolver },
  ],
  exports: [
    PlatformService,
    PlatformAdminMutationAdapter,
    PLATFORM_PROVISIONING,
    PLATFORM_PRINCIPAL_RESOLVER,
    PLATFORM_AUTHORIZATION,
    PROVISIONING_SYSTEM_PRINCIPAL,
  ],
})
export class PlatformModule {}
