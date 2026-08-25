import { Inject, Injectable } from '@nestjs/common';
import {
  integrationInbox,
  platformTenants,
  provisioningRetryRequests,
  type DatabaseClient,
} from '@commerce-platform/database';
import { and, eq, sql } from 'drizzle-orm';
import { newId } from '@commerce-platform/database';
import {
  assertIntegrationEventEnvelope,
  type IntegrationEventEnvelope,
} from '../../../common/events/integration-envelope';
import { DATABASE } from '../../database/database.tokens';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { eventDeliveryMetrics } from '../../../common/events/event-delivery.metrics';

const CONSUMER = 'provisioning.retry-request.v1';

/** Consumer boundary for the retry outbox event; duplicate EventIds are no-ops. */
@Injectable()
export class ProvisioningRetryConsumer {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(TenantProvisioningService) private readonly provisioning: TenantProvisioningService,
  ) {}

  async consume(event: IntegrationEventEnvelope) {
    assertIntegrationEventEnvelope(event);
    if (event.eventType !== 'provisioning.provisioning-retry-requested') return;
    const payload = event.payload as {
      registrationReference?: unknown;
      tenantId?: unknown;
      workflowReference?: unknown;
    };
    if (
      typeof payload.registrationReference !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.workflowReference !== 'string' ||
      event.organizationId === null
    )
      throw new Error('Invalid ProvisioningRetryRequested event payload.');
    const durablePayload = payload as {
      registrationReference: string;
      tenantId: string;
      workflowReference: string;
    };

    await this.assertDurableRequest(event, durablePayload);
    const leaseId = await this.claim(event.eventId);
    if (!leaseId) return;
    const stopTimer = eventDeliveryMetrics.consumerDuration.startTimer({
      consumer: CONSUMER,
      event_type: event.eventType,
    });
    try {
      await this.provisioning.retry({
        registrationReference: durablePayload.registrationReference,
        correlationId: event.correlationId,
        causationId: event.eventId,
      });
      // Completion records form one acknowledgement boundary. If the process
      // dies between these writes neither completion becomes durable, so relay
      // recovery replays the checkpointed provisioning command.
      await this.db.transaction(async (tx) => {
        const completed = await tx
          .update(integrationInbox)
          .set({
            status: 'COMPLETED',
            completedAt: new Date(),
            leaseExpiresAt: null,
            leaseId: null,
          })
          .where(
            and(
              eq(integrationInbox.eventId, event.eventId),
              eq(integrationInbox.consumer, CONSUMER),
              eq(integrationInbox.status, 'PROCESSING'),
              eq(integrationInbox.leaseId, leaseId),
              sql`${integrationInbox.leaseExpiresAt} > now()`,
            ),
          );
        if (completed.rowCount !== 1)
          throw new Error('Provisioning retry delivery lease was lost.');
        await tx
          .update(provisioningRetryRequests)
          .set({ status: 'COMPLETED' })
          .where(
            and(
              eq(provisioningRetryRequests.eventId, event.eventId),
              eq(provisioningRetryRequests.id, durablePayload.workflowReference),
            ),
          );
      });
      eventDeliveryMetrics.consumerCompleted.inc({
        consumer: CONSUMER,
        event_type: event.eventType,
      });
    } catch (error) {
      // A failing checkpoint is intentionally not marked completed. The next
      // relay delivery resumes the M1-008 workflow at its durable checkpoint.
      await this.db
        .update(integrationInbox)
        .set({ status: 'RETRYABLE', leaseExpiresAt: null, leaseId: null })
        .where(
          and(
            eq(integrationInbox.eventId, event.eventId),
            eq(integrationInbox.consumer, CONSUMER),
            eq(integrationInbox.leaseId, leaseId),
            sql`${integrationInbox.leaseExpiresAt} > now()`,
          ),
        );
      throw error;
    } finally {
      stopTimer();
    }
  }
  private async assertDurableRequest(
    event: IntegrationEventEnvelope,
    payload: { registrationReference: string; tenantId: string; workflowReference: string },
  ) {
    const [request] = await this.db
      .select({
        id: provisioningRetryRequests.id,
        eventId: provisioningRetryRequests.eventId,
        tenantId: provisioningRetryRequests.tenantId,
        registrationReference: provisioningRetryRequests.registrationReference,
        organizationId: platformTenants.organizationId,
      })
      .from(provisioningRetryRequests)
      .innerJoin(platformTenants, eq(platformTenants.id, provisioningRetryRequests.tenantId))
      .where(eq(provisioningRetryRequests.eventId, event.eventId))
      .limit(1);
    if (
      !request ||
      request.id !== payload.workflowReference ||
      request.eventId !== event.eventId ||
      request.tenantId !== payload.tenantId ||
      request.registrationReference !== payload.registrationReference ||
      request.organizationId !== event.organizationId
    )
      throw new Error('ProvisioningRetryRequested event does not match its durable retry request.');
  }
  private async claim(eventId: string): Promise<string | null> {
    const leaseId = newId();
    const claimed = await this.db.execute(sql`
      INSERT INTO integration.inbox (event_id, consumer, status, lease_expires_at, lease_id)
      VALUES (${eventId}::uuid, ${CONSUMER}, 'PROCESSING', now() + interval '5 minutes', ${leaseId}::uuid)
      ON CONFLICT (event_id, consumer) DO UPDATE
      SET status = 'PROCESSING', received_at = now(), completed_at = NULL,
          lease_expires_at = now() + interval '5 minutes', lease_id = ${leaseId}::uuid
      WHERE integration.inbox.status = 'RETRYABLE'
         OR (integration.inbox.status = 'PROCESSING'
             AND integration.inbox.lease_expires_at <= now())
      RETURNING lease_id
    `);
    return (claimed.rows[0]?.lease_id as string | undefined) ?? null;
  }
}
