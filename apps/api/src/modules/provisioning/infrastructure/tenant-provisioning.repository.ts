import { and, eq, type ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { integrationOutbox, newId, tenantProvisioning } from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { integrationEventEnvelope } from '../../../common/events/integration-envelope';
import {
  TenantProvisioning,
  type ProvisioningCheckpoints,
  type ProvisioningStep,
} from '../domain/tenant-provisioning';

type Executor =
  | import('@commerce-platform/database').DatabaseClient
  | PgTransaction<
      NodePgQueryResultHKT,
      Record<string, never>,
      ExtractTablesWithRelations<Record<string, never>>
    >;
export class TenantProvisioningRepository {
  async find(db: Executor, tenantId: string) {
    const [row] = await db
      .select()
      .from(tenantProvisioning)
      .where(eq(tenantProvisioning.tenantId, tenantId))
      .limit(1);
    return row ? this.hydrate(row) : null;
  }
  async create(db: Executor, input: { id: string; tenantId: string; organizationId: string }) {
    await db
      .insert(tenantProvisioning)
      .values({ ...input, currentStep: 'CreatingOrganization' })
      .onConflictDoNothing();
    return this.find(db, input.tenantId);
  }
  async save(db: Executor, record: TenantProvisioning, event: string, audit: AuditContext) {
    const nextVersion = record.version + 1;
    const updated = await db
      .update(tenantProvisioning)
      .set({
        status: record.status,
        currentStep: record.currentStep,
        checkpointsJson: record.checkpoints,
        lastError: record.lastError,
        completedAt: record.completedAt,
        version: nextVersion,
      })
      .where(
        and(eq(tenantProvisioning.id, record.id), eq(tenantProvisioning.version, record.version)),
      )
      .returning({ id: tenantProvisioning.id });
    if (!updated.length)
      throw PlatformError.versionConflict(
        `Tenant provisioning ${record.id} was modified concurrently.`,
      );
    const eventType = `provisioning.${event.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`;
    await db.insert(integrationOutbox).values({
      id: newId(),
      aggregateType: 'TenantProvisioning',
      aggregateId: record.id,
      eventType,
      correlationId: audit.correlationId,
      occurredAt: new Date(),
      payload: integrationEventEnvelope({
        eventType,
        eventVersion: 1,
        occurredAt: new Date(),
        eventScope: 'TENANT',
        organizationId: record.organizationId,
        aggregateType: 'TenantProvisioning',
        aggregateId: record.id,
        aggregateVersion: nextVersion,
        correlationId: audit.correlationId,
        causationId: audit.causationId,
        actor: { id: audit.actorId },
        payload: {
          tenantId: record.tenantId,
          organizationId: record.organizationId,
          status: record.status,
          currentStep: record.currentStep,
        },
      }),
    });
  }
  private hydrate(row: typeof tenantProvisioning.$inferSelect) {
    return new TenantProvisioning(
      row.id,
      row.tenantId,
      row.organizationId,
      row.status,
      row.currentStep as ProvisioningStep,
      row.checkpointsJson as ProvisioningCheckpoints,
      row.lastError,
      row.completedAt,
      row.version,
    );
  }
}
export interface AuditContext {
  actorId: string;
  correlationId: string;
  causationId: string;
}
