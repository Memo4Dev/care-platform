import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ENTITLEMENT_SERVICE } from './contracts';
import { EntitlementService } from './application/entitlement.service';
import { PlanService } from './application/plan.service';
import { PlanRepository } from './infrastructure/plan.repository';
import { TenantOverrideRepository } from './infrastructure/tenant-override.repository';

@Module({
  imports: [DatabaseModule, SubscriptionsModule],
  providers: [
    PlanRepository,
    TenantOverrideRepository,
    PlanService,
    EntitlementService,
    { provide: ENTITLEMENT_SERVICE, useExisting: EntitlementService },
  ],
  exports: [ENTITLEMENT_SERVICE, PlanService, PlanRepository, TenantOverrideRepository],
})
export class EntitlementsModule {}
