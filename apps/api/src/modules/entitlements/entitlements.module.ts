import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  ENTITLEMENT_SERVICE,
  SUBSCRIPTION_STATUS,
  type SubscriptionStatusContract,
} from './contracts';
import { EntitlementService } from './application/entitlement.service';
import { PlanService } from './application/plan.service';
import { PlanRepository } from './infrastructure/plan.repository';
import { TenantOverrideRepository } from './infrastructure/tenant-override.repository';

const noActiveSubscription: SubscriptionStatusContract = {
  getActiveSubscription: async () => null,
};
/** M1-006 replaces the subscription port binding; no controller is exposed in this slice. */
@Module({
  imports: [DatabaseModule],
  providers: [
    PlanRepository,
    TenantOverrideRepository,
    PlanService,
    EntitlementService,
    { provide: SUBSCRIPTION_STATUS, useValue: noActiveSubscription },
    { provide: ENTITLEMENT_SERVICE, useExisting: EntitlementService },
  ],
  exports: [ENTITLEMENT_SERVICE],
})
export class EntitlementsModule {}
