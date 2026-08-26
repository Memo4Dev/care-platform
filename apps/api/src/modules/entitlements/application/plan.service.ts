import { PlatformError } from '@commerce-platform/contracts';
import { type DatabaseClient, newId } from '@commerce-platform/database';
import { Inject, Injectable } from '@nestjs/common';
import { DATABASE } from '../../database/database.tokens';
import { Plan } from '../domain/plan';
import { TenantEntitlementOverride } from '../domain/tenant-entitlement-override';
import { PlanRepository, type AuditContext } from '../infrastructure/plan.repository';
import { TenantOverrideRepository } from '../infrastructure/tenant-override.repository';
import type { DbExecutor } from '../infrastructure/db-executor';

/** Write-side application service. Platform authorization arrives with Platform Admin API. */
@Injectable()
export class PlanService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(PlanRepository) private readonly plans: PlanRepository,
    @Inject(TenantOverrideRepository) private readonly overrides: TenantOverrideRepository,
  ) {}
  async createPlan(command: { planId?: string; code: string; name: string } & AuditContext) {
    const plan = Plan.create({
      id: command.planId ?? newId(),
      code: command.code,
      name: command.name,
    });
    return this.db.transaction((tx) => this.createPlanInTransaction(tx, command, plan));
  }
  async createPlanInTransaction(
    tx: DbExecutor,
    command: { planId?: string; code: string; name: string } & AuditContext,
    plan = Plan.create({ id: command.planId ?? newId(), code: command.code, name: command.name }),
  ) {
    return { plan: snapshot(plan), eventsPersisted: await this.plans.save(tx, plan, command) };
  }
  async updatePlan(command: { planId: string; code?: string; name?: string } & AuditContext) {
    return this.executePlan(command.planId, command, (plan) => plan.update(command));
  }
  async activatePlan(command: { planId: string } & AuditContext) {
    return this.executePlan(command.planId, command, (plan) => plan.activate());
  }
  async deactivatePlan(command: { planId: string } & AuditContext) {
    return this.executePlan(command.planId, command, (plan) => plan.deactivate());
  }
  async setPlanEntitlement(
    command: { planId: string; code: string; value: boolean } & AuditContext,
  ) {
    return this.executePlan(command.planId, command, (plan) =>
      plan.setEntitlement(command.code, command.value),
    );
  }
  async setPlanLimit(command: { planId: string; code: string; value: number } & AuditContext) {
    return this.executePlan(command.planId, command, (plan) =>
      plan.setLimit(command.code, command.value),
    );
  }
  async grantTenantEntitlementOverride(
    command: {
      overrideId?: string;
      organizationId: string;
      code: string;
      value: boolean | number;
      effectiveFrom: Date;
      effectiveTo?: Date | null;
      reason: string;
      actorType: 'PLATFORM_USER' | 'SYSTEM_SERVICE';
      actorId: string;
    } & AuditContext,
  ) {
    const override = TenantEntitlementOverride.grant({
      ...command,
      correlationId: command.correlationId,
      id: command.overrideId ?? newId(),
    });
    return this.db.transaction((tx) =>
      this.grantTenantEntitlementOverrideInTransaction(tx, command, override),
    );
  }
  async grantTenantEntitlementOverrideInTransaction(
    tx: DbExecutor,
    command: Parameters<PlanService['grantTenantEntitlementOverride']>[0],
    override = TenantEntitlementOverride.grant({
      ...command,
      correlationId: command.correlationId,
      id: command.overrideId ?? newId(),
    }),
  ) {
    return {
      overrideId: override.id,
      eventsPersisted: await this.overrides.save(tx, override, command),
    };
  }
  async revokeTenantEntitlementOverride(
    command: { organizationId: string; overrideId: string } & AuditContext,
  ) {
    return this.db.transaction((tx) =>
      this.revokeTenantEntitlementOverrideInTransaction(tx, command),
    );
  }
  async revokeTenantEntitlementOverrideInTransaction(
    tx: DbExecutor,
    command: { organizationId: string; overrideId: string } & AuditContext,
  ) {
    const override = await this.overrides.findOverride(
      tx,
      command.organizationId,
      command.overrideId,
    );
    if (!override)
      throw PlatformError.notFound(`Tenant override ${command.overrideId} was not found.`, {
        details: { organizationId: command.organizationId, overrideId: command.overrideId },
      });
    override.revoke();
    return {
      overrideId: override.id,
      eventsPersisted: await this.overrides.save(tx, override, command),
    };
  }
  private async executePlan(planId: string, audit: AuditContext, command: (plan: Plan) => void) {
    return this.db.transaction((tx) => this.executePlanInTransaction(tx, planId, audit, command));
  }
  async executePlanInTransaction(
    tx: DbExecutor,
    planId: string,
    audit: AuditContext,
    command: (plan: Plan) => void,
  ) {
    const plan = await this.plans.findPlan(tx, planId);
    if (!plan)
      throw PlatformError.notFound(`Plan ${planId} was not found.`, { details: { planId } });
    command(plan);
    const eventsPersisted = await this.plans.save(tx, plan, audit);
    return { plan: snapshot(plan), eventsPersisted };
  }
}
function snapshot(plan: Plan) {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    status: plan.status,
    version: plan.version,
    entitlements: plan.listEntitlements(),
  };
}
