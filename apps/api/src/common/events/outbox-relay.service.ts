import { Inject, Injectable } from '@nestjs/common';
import { integrationOutbox, type DatabaseClient } from '@commerce-platform/database';
import { Queue, type ConnectionOptions } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';
import {
  assertIntegrationEventEnvelope,
  type IntegrationEventEnvelope,
} from './integration-envelope';
import { eventDeliveryMetrics } from './event-delivery.metrics';
import { DATABASE } from '../../modules/database/database.tokens';

export const INTEGRATION_EVENT_QUEUE = 'integration-events-v1';

export interface IntegrationQueue {
  add(
    name: string,
    data: IntegrationEventEnvelope,
    options: {
      jobId: string;
      attempts: number;
      backoff: { type: 'exponential'; delay: number };
      removeOnComplete: boolean;
      removeOnFail: boolean;
    },
  ): Promise<unknown>;
  getFailedCount?: () => Promise<number>;
}

@Injectable()
export class OutboxRelayService {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  async relayOnce(queue: IntegrationQueue, batchSize = 25): Promise<number> {
    const claimed = await this.claim(batchSize);
    for (const row of claimed) {
      try {
        const event = row.payload as IntegrationEventEnvelope;
        assertIntegrationEventEnvelope(event);
        await queue.add(event.eventType, event, {
          // EventId makes publication retry safe: a crash after Queue.add but
          // before PostgreSQL confirmation simply encounters the same Bull job.
          jobId: event.eventId,
          attempts: 8,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: false,
          removeOnFail: false,
        });
        const marked = await this.db
          .update(integrationOutbox)
          .set({
            publishedAt: new Date(),
            publishLeaseId: null,
            publishLeaseExpiresAt: null,
            lastPublishError: null,
          })
          .where(
            and(
              eq(integrationOutbox.id, row.id),
              eq(integrationOutbox.publishLeaseId, row.leaseId),
              sql`${integrationOutbox.publishLeaseExpiresAt} > now()`,
            ),
          );
        if (marked.rowCount === 1)
          eventDeliveryMetrics.relayPublished.inc({ event_type: event.eventType });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message.slice(0, 1_000)
            : 'Unknown outbox publication failure';
        await this.db
          .update(integrationOutbox)
          .set({ publishLeaseId: null, publishLeaseExpiresAt: null, lastPublishError: message })
          .where(
            and(
              eq(integrationOutbox.id, row.id),
              eq(integrationOutbox.publishLeaseId, row.leaseId),
              sql`${integrationOutbox.publishLeaseExpiresAt} > now()`,
            ),
          );
        eventDeliveryMetrics.relayFailures.inc({ event_type: row.eventType });
      }
    }
    if (queue.getFailedCount)
      eventDeliveryMetrics.bullmqFailedJobs.set(await queue.getFailedCount());
    return claimed.length;
  }

  private async claim(
    batchSize: number,
  ): Promise<Array<{ id: string; leaseId: string; eventType: string; payload: unknown }>> {
    const limit = Math.max(1, Math.min(batchSize, 100));
    // SKIP LOCKED lets horizontally scaled relays make progress without waiting.
    const result = await this.db.execute(sql`
      WITH candidates AS (
        SELECT id FROM integration.outbox
        WHERE published_at IS NULL
          AND (publish_lease_expires_at IS NULL OR publish_lease_expires_at <= now())
        ORDER BY occurred_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE integration.outbox AS outbox
      SET publish_lease_id = gen_random_uuid(),
          publish_lease_expires_at = now() + interval '1 minute',
          publish_attempts = outbox.publish_attempts + 1
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.id, outbox.publish_lease_id, outbox.event_type, outbox.payload
    `);
    return result.rows.map((row) => ({
      id: row.id as string,
      leaseId: row.publish_lease_id as string,
      eventType: row.event_type as string,
      payload: row.payload,
    }));
  }
}

export function createIntegrationQueue(connection: ConnectionOptions): Queue {
  return new Queue(INTEGRATION_EVENT_QUEUE, { connection });
}
