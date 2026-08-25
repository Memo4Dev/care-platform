import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  idempotencyOutcomes,
  integrationOutbox,
  newId,
  platformTenants,
  provisioningRetryRequests,
  tenantProvisioning,
  type DatabaseClient,
} from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { integrationEventEnvelope } from '../../../common/events/integration-envelope';
import { DATABASE } from '../../database/database.tokens';

/**
 * Accepts a retry as one local transaction. It deliberately does not run the
 * workflow on the HTTP request: the committed outbox event is the hand-off to
 * the checkpointed M1-008 process manager.
 */
@Injectable()
export class ProvisioningRetryRequestService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  async request(input: ProvisioningRetryRequestInput): Promise<ProvisioningRetryRequestResult> {
    return this.db.transaction(async (tx) => {
      const requestHash = hash(input.registrationReference);
      // Check the caller's key before resolving the workflow reference: a key
      // permanently identifies its original request, including on replay.
      const [outcome] = await tx
        .select()
        .from(idempotencyOutcomes)
        .where(
          and(
            eq(idempotencyOutcomes.scope, input.idempotencyScope),
            eq(idempotencyOutcomes.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (outcome) {
        if (outcome.requestHash !== requestHash)
          throw PlatformError.idempotencyConflict(
            'Idempotency-Key is already associated with a different request.',
          );
        if (outcome.status !== 'COMPLETED' || !outcome.responseJson)
          throw PlatformError.idempotencyConflict(
            'Idempotency-Key request is already in progress.',
          );
        return outcome.responseJson as ProvisioningRetryRequestResult;
      }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.tenantId}, 8))`);
      // Another request with this key may have completed while this request
      // waited for the tenant workflow lock.
      const [serializedOutcome] = await tx
        .select()
        .from(idempotencyOutcomes)
        .where(
          and(
            eq(idempotencyOutcomes.scope, input.idempotencyScope),
            eq(idempotencyOutcomes.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (serializedOutcome) {
        if (serializedOutcome.requestHash !== requestHash)
          throw PlatformError.idempotencyConflict(
            'Idempotency-Key is already associated with a different request.',
          );
        if (serializedOutcome.status !== 'COMPLETED' || !serializedOutcome.responseJson)
          throw PlatformError.idempotencyConflict(
            'Idempotency-Key request is already in progress.',
          );
        return serializedOutcome.responseJson as ProvisioningRetryRequestResult;
      }
      const [tenant] = await tx
        .select({
          id: platformTenants.id,
          registrationReference: platformTenants.registrationReference,
        })
        .from(platformTenants)
        .where(eq(platformTenants.id, input.tenantId))
        .limit(1);
      if (!tenant) throw PlatformError.notFound('Platform tenant was not found.');
      if (tenant.registrationReference !== input.registrationReference)
        throw PlatformError.permissionDenied(
          'Retry reference does not belong to this platform tenant.',
        );

      const [active] = await tx
        .select()
        .from(provisioningRetryRequests)
        .where(
          and(
            eq(provisioningRetryRequests.tenantId, input.tenantId),
            eq(provisioningRetryRequests.status, 'REQUESTED'),
          ),
        )
        .limit(1);
      const [workflow] = await tx
        .select({ id: tenantProvisioning.id })
        .from(tenantProvisioning)
        .where(eq(tenantProvisioning.tenantId, input.tenantId))
        .limit(1);
      const result: ProvisioningRetryRequestResult = active
        ? { workflowReference: active.id, eventId: active.eventId, deduplicated: true }
        : { workflowReference: newId(), eventId: newId(), deduplicated: false };

      if (!active) {
        await tx.insert(provisioningRetryRequests).values({
          id: result.workflowReference,
          tenantId: input.tenantId,
          provisioningId: workflow?.id,
          registrationReference: input.registrationReference,
          idempotencyScope: input.idempotencyScope,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          eventId: result.eventId,
        });
        const eventType = 'provisioning.provisioning-retry-requested';
        await tx.insert(integrationOutbox).values({
          id: result.eventId,
          aggregateType: 'TenantProvisioning',
          aggregateId: workflow?.id ?? input.tenantId,
          eventType,
          correlationId: input.correlationId,
          occurredAt: new Date(),
          payload: integrationEventEnvelope({
            eventId: result.eventId,
            eventType,
            eventVersion: 1,
            occurredAt: new Date(),
            eventScope: 'TENANT',
            organizationId: input.organizationId,
            aggregateType: 'TenantProvisioning',
            aggregateId: workflow?.id ?? input.tenantId,
            aggregateVersion: 1,
            correlationId: input.correlationId,
            causationId: input.causationId,
            actor: { id: input.actorId },
            payload: {
              tenantId: input.tenantId,
              workflowReference: result.workflowReference,
              registrationReference: input.registrationReference,
            },
          }),
        });
      }
      await tx.insert(idempotencyOutcomes).values({
        id: newId(),
        scope: input.idempotencyScope,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        status: 'COMPLETED',
        responseJson: result,
        completedAt: new Date(),
      });
      return result;
    });
  }
}

export interface ProvisioningRetryRequestInput {
  tenantId: string;
  organizationId: string;
  registrationReference: string;
  idempotencyScope: string;
  idempotencyKey: string;
  actorId: string;
  correlationId: string;
  causationId: string;
}
export interface ProvisioningRetryRequestResult {
  workflowReference: string;
  eventId: string;
  deduplicated: boolean;
}
function hash(registrationReference: string) {
  return createHash('sha256').update(JSON.stringify({ registrationReference })).digest('hex');
}
