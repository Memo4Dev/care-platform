import { and, eq, ne } from 'drizzle-orm';
import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import {
  integrationOutbox,
  newId,
  platformTenants,
  supportSessions,
} from '@commerce-platform/database';
import { integrationEventEnvelope } from '../../../common/events/integration-envelope';
import { PlatformTenant } from '../domain/platform-tenant';
import { PLATFORM_TENANT_AGGREGATE_TYPE } from '../domain/events';
import type { TrustedRegistrationSnapshot } from '../application/platform-registration.contract';
import type { VerifiedTenantRegistrationSnapshot } from '../application/platform-provisioning.contract';
import type { DbExecutor } from './db-executor';

export interface PlatformAuditContext {
  actorId: string;
  correlationId: string;
  causationId: string;
}
export class PlatformTenantRepository {
  async find(executor: DbExecutor, tenantId: string, clock?: () => Date) {
    const [row] = await executor
      .select()
      .from(platformTenants)
      .where(eq(platformTenants.id, tenantId))
      .limit(1);
    if (!row) return null;
    const sessions = await executor
      .select()
      .from(supportSessions)
      .where(
        and(
          eq(supportSessions.tenantId, tenantId),
          eq(supportSessions.organizationId, row.organizationId),
        ),
      );
    return PlatformTenant.reconstitute({ ...row, sessions }, { clock });
  }
  async findByOrganization(executor: DbExecutor, organizationId: string, clock?: () => Date) {
    const [row] = await executor
      .select({ id: platformTenants.id })
      .from(platformTenants)
      .where(eq(platformTenants.organizationId, organizationId))
      .limit(1);
    return row ? this.find(executor, row.id, clock) : null;
  }
  async findVerifiedRegistration(
    executor: DbExecutor,
    reference: string,
  ): Promise<VerifiedTenantRegistrationSnapshot | null> {
    const rows = await executor
      .select({
        tenantId: platformTenants.id,
        organizationId: platformTenants.organizationId,
        reference: platformTenants.registrationReference,
        requestedOrganizationName: platformTenants.registrationRequestedOrganizationName,
        supabaseSubject: platformTenants.registrationOwnerSupabaseSubject,
        email: platformTenants.registrationOwnerEmail,
        displayName: platformTenants.registrationOwnerDisplayName,
        verifiedAt: platformTenants.registrationVerifiedAt,
      })
      .from(platformTenants)
      .where(
        and(
          eq(platformTenants.registrationReference, reference),
          eq(platformTenants.registrationStatus, 'VERIFIED'),
          ne(platformTenants.registrationReference, 'legacy'),
        ),
      );
    if (rows.length !== 1) return null;
    const [row] = rows;
    return {
      tenantId: row.tenantId,
      organizationId: row.organizationId,
      reference: row.reference,
      requestedOrganizationName: row.requestedOrganizationName,
      owner: {
        supabaseSubject: row.supabaseSubject,
        email: row.email,
        displayName: row.displayName,
      },
      verifiedAt: row.verifiedAt,
    };
  }
  async save(
    executor: DbExecutor,
    tenant: PlatformTenant,
    audit: PlatformAuditContext,
    registration?: TrustedRegistrationSnapshot,
  ) {
    if (!tenant.hasPendingChanges) return 0;
    const c = tenant.collectChanges();
    if (c.isNew)
      await executor.insert(platformTenants).values({
        id: c.tenantId,
        organizationId: c.organizationId,
        status: c.status,
        provisioningStatus: c.provisioningStatus,
        subscriptionId: c.subscriptionId,
        subscriptionVersion: c.subscriptionVersion,
        suspendedReason: c.suspendedReason,
        ...(registration
          ? {
              registrationReference: registration.reference,
              registrationStatus: 'VERIFIED',
              registrationRequestedOrganizationName: registration.requestedOrganizationName,
              registrationOwnerSupabaseSubject: registration.owner.supabaseSubject,
              registrationOwnerEmail: registration.owner.email,
              registrationOwnerDisplayName: registration.owner.displayName,
              registrationVerifiedAt: registration.verifiedAt,
            }
          : {}),
        version: c.nextVersion,
      });
    else {
      const updated = await executor
        .update(platformTenants)
        .set({
          status: c.status,
          provisioningStatus: c.provisioningStatus,
          subscriptionId: c.subscriptionId,
          subscriptionVersion: c.subscriptionVersion,
          suspendedReason: c.suspendedReason,
          version: c.nextVersion,
          updatedAt: new Date(),
        })
        .where(
          and(eq(platformTenants.id, c.tenantId), eq(platformTenants.version, c.expectedVersion)),
        )
        .returning({ id: platformTenants.id });
      if (!updated.length)
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Platform tenant ${c.tenantId} was modified concurrently.`,
          { details: { tenantId: c.tenantId, expectedVersion: c.expectedVersion } },
        );
    }
    if (c.newSessions.length)
      await executor.insert(supportSessions).values(
        c.newSessions.map((s) => ({
          ...s,
          tenantId: c.tenantId,
          organizationId: c.organizationId,
          requestedByLegacy: s.requestedByPlatformUserId,
        })),
      );
    for (const s of c.changedSessions) {
      const updated = await executor
        .update(supportSessions)
        .set({
          status: s.status,
          startedByPlatformUserId: s.startedByPlatformUserId,
          endedByPlatformUserId: s.endedByPlatformUserId,
          startedByLegacy: s.startedByPlatformUserId,
          endedByLegacy: s.endedByPlatformUserId,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          endReason: s.endReason,
          version: s.version,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(supportSessions.id, s.id),
            eq(supportSessions.tenantId, c.tenantId),
            eq(supportSessions.version, s.version - 1),
          ),
        )
        .returning({ id: supportSessions.id });
      if (!updated.length)
        throw PlatformError.versionConflict(`Support session ${s.id} was modified concurrently.`);
    }
    const events = tenant.pullDomainEvents();
    if (events.length)
      await executor.insert(integrationOutbox).values(
        events.map((event) => {
          const eventType = `platform.${event.type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`;
          return {
            id: newId(),
            aggregateType: PLATFORM_TENANT_AGGREGATE_TYPE,
            aggregateId: c.tenantId,
            eventType,
            correlationId: audit.correlationId,
            occurredAt: event.occurredAt,
            payload: integrationEventEnvelope({
              eventType,
              eventVersion: 1,
              occurredAt: event.occurredAt,
              eventScope: 'TENANT',
              organizationId: event.organizationId,
              aggregateType: PLATFORM_TENANT_AGGREGATE_TYPE,
              aggregateId: c.tenantId,
              aggregateVersion: c.nextVersion,
              correlationId: audit.correlationId,
              causationId: audit.causationId,
              actor: { id: audit.actorId },
              payload: {
                tenantId: event.tenantId,
                organizationId: event.organizationId,
                status: event.status,
                provisioningStatus: event.provisioningStatus,
                ...(event.supportSessionId
                  ? {
                      supportSessionId: event.supportSessionId,
                      supportStatus: event.supportStatus,
                      reason: event.supportReason,
                    }
                  : {}),
              },
            }),
          };
        }),
      );
    tenant.markPersisted();
    return events.length;
  }
}
