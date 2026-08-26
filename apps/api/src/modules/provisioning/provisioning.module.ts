import { Module } from '@nestjs/common';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationModule } from '../organization/organization.module';
import { PlatformModule } from '../platform/platform.module';
import { ProvisioningExecutionModule } from '../../common/provisioning-execution/provisioning-execution.module';
import { TenantProvisioningService } from './application/tenant-provisioning.service';
import { ProvisioningRetryConsumer } from './application/provisioning-retry.consumer';
import { EventWorkerService } from '../../common/events/event-worker.service';
import { OutboxRelayService } from '../../common/events/outbox-relay.service';
import { ProvisioningRetryRequestService } from './application/provisioning-retry-request.service';
import { TenantProvisioningRepository } from './infrastructure/tenant-provisioning.repository';

@Module({
  imports: [
    DatabaseModule,
    PlatformModule,
    OrganizationModule,
    IdentityModule,
    EntitlementsModule,
    ProvisioningExecutionModule,
  ],
  providers: [
    TenantProvisioningRepository,
    TenantProvisioningService,
    ProvisioningRetryRequestService,
    ProvisioningRetryConsumer,
    EventWorkerService,
    OutboxRelayService,
  ],
  exports: [
    TenantProvisioningService,
    TenantProvisioningRepository,
    ProvisioningRetryRequestService,
    ProvisioningRetryConsumer,
    EventWorkerService,
    OutboxRelayService,
  ],
})
export class ProvisioningModule {}
