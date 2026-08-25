import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PlatformService } from './application/platform.service';
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
@Module({
  imports: [DatabaseModule],
  providers: [
    PlatformTenantRepository,
    PlatformService,
    PlatformProvisioningService,
    { provide: PLATFORM_AUTHORIZATION, useClass: DatabasePlatformAuthorizationProvider },
    { provide: PLATFORM_PRINCIPAL_RESOLVER, useClass: DatabasePlatformPrincipalResolver },
    { provide: PROVISIONING_SYSTEM_PRINCIPAL, useClass: FixedProvisioningSystemPrincipalProvider },
    { provide: PLATFORM_PROVISIONING, useExisting: PlatformProvisioningService },
  ],
  exports: [PlatformService, PLATFORM_PROVISIONING, PLATFORM_PRINCIPAL_RESOLVER],
})
export class PlatformModule {}
