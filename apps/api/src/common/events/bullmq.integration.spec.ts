import {
  integrationInbox,
  integrationOutbox,
  newId,
  organizations,
  platformTenants,
  provisioningRetryRequests,
} from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import { eq } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRedisConfig } from './delivery-config';
import { EventWorkerService } from './event-worker.service';
import { integrationEventEnvelope } from './integration-envelope';
import { INTEGRATION_EVENT_QUEUE, OutboxRelayService } from './outbox-relay.service';
import { ProvisioningRetryConsumer } from '../../modules/provisioning/application/provisioning-retry.consumer';

const redisEnabled = process.env.REDIS_INTEGRATION === 'true';
const integration = redisEnabled ? describe : describe.skip;

integration('BullMQ EventId deduplication (requires REDIS_INTEGRATION=true)', () => {
  const workers: Worker[] = [];
  const queues: Queue[] = [];
  let testdb: TestDatabase;
  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
    await Promise.all(queues.splice(0).map((queue) => queue.close()));
    await testdb?.teardown();
  });

  it('keeps one queue job for repeated EventId publication', async () => {
    const connection = readRedisConfig();
    const queue = new Queue(`${INTEGRATION_EVENT_QUEUE}-test`, { connection });
    queues.push(queue);
    const eventId = crypto.randomUUID();
    const first = await queue.add(
      'test.event',
      { eventId },
      { jobId: eventId, removeOnComplete: false },
    );
    const second = await queue.add(
      'test.event',
      { eventId },
      { jobId: eventId, removeOnComplete: false },
    );
    expect(second.id).toBe(first.id);
    expect(await queue.getJobCountByTypes('waiting', 'active', 'completed')).toBe(1);
  });

  it('relays through Redis, retries the worker handoff, and completes one Inbox delivery', async () => {
    testdb = await createTestDatabase();
    const organizationId = newId();
    const tenantId = newId();
    const eventId = newId();
    const workflowReference = newId();
    const registrationReference = `verified-${newId()}`;
    await testdb.db.insert(organizations).values({ id: organizationId, name: 'Redis tenant' });
    await testdb.db.insert(platformTenants).values({
      id: tenantId,
      organizationId,
      registrationReference,
      registrationStatus: 'VERIFIED',
      registrationRequestedOrganizationName: 'Redis tenant',
      registrationOwnerSupabaseSubject: `owner-${newId()}`,
      registrationOwnerEmail: `owner-${newId()}@example.test`,
      registrationOwnerDisplayName: 'Owner',
    });
    await testdb.db.insert(provisioningRetryRequests).values({
      id: workflowReference,
      tenantId,
      registrationReference,
      idempotencyScope: `redis:${newId()}`,
      idempotencyKey: newId(),
      requestHash: 'test',
      eventId,
    });
    const event = integrationEventEnvelope({
      eventId,
      eventType: 'provisioning.provisioning-retry-requested',
      eventVersion: 1,
      occurredAt: new Date(),
      eventScope: 'TENANT',
      organizationId,
      aggregateType: 'TenantProvisioning',
      aggregateId: newId(),
      aggregateVersion: 1,
      correlationId: newId(),
      causationId: newId(),
      actor: { id: 'SYSTEM:test' },
      payload: { tenantId, workflowReference, registrationReference },
    });
    await testdb.db.insert(integrationOutbox).values({
      id: newId(),
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      correlationId: event.correlationId,
      occurredAt: new Date(event.occurredAt),
      payload: event,
    });

    let attempts = 0;
    const retry = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient handoff failure');
    };
    const consumer = new ProvisioningRetryConsumer(testdb.db, { retry } as never);
    const queue = new Queue(INTEGRATION_EVENT_QUEUE, { connection: readRedisConfig() });
    queues.push(queue);
    const worker = new Worker(
      INTEGRATION_EVENT_QUEUE,
      (job) => new EventWorkerService(consumer).process(job),
      { connection: readRedisConfig() },
    );
    workers.push(worker);

    const relay = new OutboxRelayService(testdb.db);
    await expect(relay.relayOnce(queue)).resolves.toBe(1);
    await expect(relay.relayOnce(queue)).resolves.toBe(0);
    await vi.waitFor(
      async () => {
        const [inbox] = await testdb.db
          .select()
          .from(integrationInbox)
          .where(eq(integrationInbox.eventId, eventId));
        expect(attempts).toBe(2);
        expect(inbox).toMatchObject({ status: 'COMPLETED', completedAt: expect.any(Date) });
      },
      { timeout: 15_000 },
    );
    expect(await queue.getJob(eventId)).toMatchObject({ id: eventId, attemptsMade: 2 });
  });
});
