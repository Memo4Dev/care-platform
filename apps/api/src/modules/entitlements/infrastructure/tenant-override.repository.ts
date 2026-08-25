import {
  integrationOutbox,
  newId,
  tenantOverrides,
  type EntitlementValue,
} from '@commerce-platform/database';
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { TenantEntitlementOverride } from '../domain/tenant-entitlement-override';
import { TENANT_OVERRIDE_AGGREGATE_TYPE } from '../domain/events';
import type { DbExecutor } from './db-executor';
import { entitlementEventEnvelope } from './event-envelope';
import type { AuditContext } from './plan.repository';

/** All reads include organizationId; cross-tenant IDs are indistinguishable from misses. */
export class TenantOverrideRepository {
  async findOverride(
    executor: DbExecutor,
    organizationId: string,
    overrideId: string,
  ): Promise<TenantEntitlementOverride | null> {
    const [row] = await executor
      .select()
      .from(tenantOverrides)
      .where(
        and(eq(tenantOverrides.id, overrideId), eq(tenantOverrides.organizationId, organizationId)),
      )
      .limit(1);
    return row
      ? TenantEntitlementOverride.reconstitute({
          id: row.id,
          organizationId: row.organizationId,
          code: row.code,
          value: row.valueJson as EntitlementValue,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          reason: row.reason,
          actorType: row.actorType as 'PLATFORM_USER' | 'SYSTEM_SERVICE',
          actorId: row.actorId,
          correlationId: row.correlationId,
        })
      : null;
  }
  async findCurrentValue(
    executor: DbExecutor,
    organizationId: string,
    code: string,
    now: Date,
  ): Promise<{ value: EntitlementValue; source: 'override' } | null> {
    const [row] = await executor
      .select({ value: tenantOverrides.valueJson })
      .from(tenantOverrides)
      .where(
        and(
          eq(tenantOverrides.organizationId, organizationId),
          eq(tenantOverrides.code, code),
          lte(tenantOverrides.effectiveFrom, now),
          or(isNull(tenantOverrides.effectiveTo), gt(tenantOverrides.effectiveTo, now)),
        ),
      )
      .orderBy(
        desc(tenantOverrides.effectiveFrom),
        desc(tenantOverrides.createdAt),
        desc(tenantOverrides.id),
      )
      .limit(1);
    return row ? { value: row.value as EntitlementValue, source: 'override' } : null;
  }
  async save(
    executor: DbExecutor,
    override: TenantEntitlementOverride,
    audit: AuditContext,
  ): Promise<number> {
    if (!override.hasPendingChanges) return 0;
    if (override.isNew)
      await executor.insert(tenantOverrides).values({
        id: override.id,
        organizationId: override.organizationId,
        code: override.code,
        valueJson: override.value,
        effectiveFrom: override.effectiveFrom,
        effectiveTo: override.effectiveTo,
        reason: override.reason,
        actorType: override.actorType,
        actorId: override.actorId,
        correlationId: override.correlationId,
      });
    if (override.isRevoked)
      await executor
        .delete(tenantOverrides)
        .where(
          and(
            eq(tenantOverrides.id, override.id),
            eq(tenantOverrides.organizationId, override.organizationId),
          ),
        );
    const events = override.pullDomainEvents();
    if (events.length)
      await executor.insert(integrationOutbox).values(
        events.map((event) => ({
          id: newId(),
          aggregateType: TENANT_OVERRIDE_AGGREGATE_TYPE,
          aggregateId: override.id,
          eventType: `entitlements.${event.type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
          payload: entitlementEventEnvelope({
            event: event as unknown as Record<string, unknown>,
            aggregateType: TENANT_OVERRIDE_AGGREGATE_TYPE,
            aggregateId: override.id,
            aggregateVersion: 1,
            eventScope: 'TENANT',
            ...audit,
          }),
          correlationId: audit.correlationId,
          occurredAt: event.occurredAt,
        })),
      );
    override.markPersisted();
    return events.length;
  }
}
