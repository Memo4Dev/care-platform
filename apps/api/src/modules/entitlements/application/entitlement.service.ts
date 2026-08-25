import { Inject, Injectable } from '@nestjs/common';
import { type DatabaseClient, type EntitlementValue } from '@commerce-platform/database';

import { DATABASE } from '../../database/database.tokens';
import {
  SUBSCRIPTION_STATUS,
  type EntitlementCheck,
  type EntitlementServiceContract,
  type LimitUsage,
  type SubscriptionStatusContract,
} from '../contracts';
import { PlanRepository } from '../infrastructure/plan.repository';
import { TenantOverrideRepository } from '../infrastructure/tenant-override.repository';
import type { FeatureEntitlementCode, LimitEntitlementCode } from '../domain/registry';

/** Capability-only read service. It deliberately contains no plan-code branching. */
@Injectable()
export class EntitlementService implements EntitlementServiceContract {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(SUBSCRIPTION_STATUS) private readonly subscriptions: SubscriptionStatusContract,
    @Inject(PlanRepository) private readonly plans: PlanRepository,
    @Inject(TenantOverrideRepository) private readonly overrides: TenantOverrideRepository,
  ) {}
  async canUseFeature(
    organizationId: string,
    code: FeatureEntitlementCode,
  ): Promise<EntitlementCheck> {
    const resolved = await this.resolve(organizationId, code);
    return { allowed: resolved.value === true, code, source: resolved.source };
  }
  async checkLimit(
    organizationId: string,
    code: LimitEntitlementCode,
    currentUsage: number,
  ): Promise<LimitUsage> {
    return this.getLimitUsage(organizationId, code, currentUsage);
  }
  async getLimitUsage(
    organizationId: string,
    code: LimitEntitlementCode,
    currentUsage: number,
  ): Promise<LimitUsage> {
    if (!Number.isInteger(currentUsage) || currentUsage < 0)
      throw new Error('currentUsage must be a non-negative integer.');
    const resolved = await this.resolve(organizationId, code);
    const limit = typeof resolved.value === 'number' ? resolved.value : null;
    return {
      allowed: limit !== null && currentUsage < limit,
      code,
      limit,
      currentUsage,
      source: resolved.source,
    };
  }
  private async resolve(
    organizationId: string,
    code: string,
  ): Promise<{ value: EntitlementValue | null; source: 'plan' | 'override' | 'none' }> {
    const now = new Date();
    const subscription = await this.subscriptions.getActiveSubscription(organizationId);
    if (!subscription || subscription.organizationId !== organizationId)
      return { value: null, source: 'none' };
    const plan = await this.plans.findActivePlan(this.db, subscription.planId);
    if (!plan) return { value: null, source: 'none' };
    const override = await this.overrides.findCurrentValue(this.db, organizationId, code, now);
    if (override) return override;
    const value = plan?.listEntitlements().find((entry) => entry.code === code)?.value;
    return value === undefined ? { value: null, source: 'none' } : { value, source: 'plan' };
  }
}
