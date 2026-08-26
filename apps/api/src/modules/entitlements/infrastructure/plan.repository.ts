import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import {
  integrationOutbox,
  newId,
  planEntitlements,
  plans,
  type EntitlementValue,
} from '@commerce-platform/database';
import { and, eq } from 'drizzle-orm';
import { Plan } from '../domain/plan';
import { PLAN_AGGREGATE_TYPE } from '../domain/events';
import type { DbExecutor } from './db-executor';
import { entitlementEventEnvelope } from './event-envelope';

export class PlanRepository {
  async findPlan(executor: DbExecutor, planId: string): Promise<Plan | null> {
    const [row] = await executor.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!row) return null;
    const values = await executor
      .select()
      .from(planEntitlements)
      .where(eq(planEntitlements.planId, planId));
    return Plan.reconstitute({
      ...row,
      entitlements: values.map((value) => ({
        code: value.code,
        value: value.valueJson as EntitlementValue,
      })),
    });
  }
  async findActivePlan(executor: DbExecutor, planId: string) {
    const plan = await this.findPlan(executor, planId);
    return plan?.status === 'ACTIVE' ? plan : null;
  }
  async save(executor: DbExecutor, plan: Plan, audit: AuditContext): Promise<number> {
    if (!plan.hasPendingChanges) return 0;
    const changes = plan.collectChanges();
    if (changes.isNew)
      await executor.insert(plans).values({
        id: changes.planId,
        code: changes.code,
        name: changes.name,
        status: changes.status,
        version: changes.nextVersion,
      });
    else {
      const updated = await executor
        .update(plans)
        .set({
          code: changes.code,
          name: changes.name,
          status: changes.status,
          version: changes.nextVersion,
          updatedAt: new Date(),
        })
        .where(and(eq(plans.id, changes.planId), eq(plans.version, changes.expectedVersion)))
        .returning({ id: plans.id });
      if (!updated.length) throw versionConflict(changes.planId, changes.expectedVersion);
    }
    await executor.delete(planEntitlements).where(eq(planEntitlements.planId, changes.planId));
    if (changes.entitlements.length)
      await executor.insert(planEntitlements).values(
        changes.entitlements.map((entry) => ({
          planId: changes.planId,
          code: entry.code,
          valueJson: entry.value,
        })),
      );
    const events = plan.pullDomainEvents();
    if (events.length)
      await executor.insert(integrationOutbox).values(
        events.map((event) => ({
          id: newId(),
          aggregateType: PLAN_AGGREGATE_TYPE,
          aggregateId: changes.planId,
          eventType: `entitlements.${event.type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
          payload: entitlementEventEnvelope({
            event: event as unknown as Record<string, unknown>,
            aggregateType: PLAN_AGGREGATE_TYPE,
            aggregateId: changes.planId,
            aggregateVersion: changes.nextVersion,
            eventScope: 'GLOBAL',
            ...audit,
          }),
          correlationId: audit.correlationId,
          occurredAt: event.occurredAt,
        })),
      );
    plan.markPersisted();
    return events.length;
  }
}
export interface AuditContext {
  actorId: string;
  correlationId: string;
  causationId: string;
}
function versionConflict(planId: string, expectedVersion: number) {
  return PlatformError.of(
    ERROR_CODES.RESOURCE_VERSION_CONFLICT,
    `Plan ${planId} was modified concurrently.`,
    { details: { planId, expectedVersion } },
  );
}
