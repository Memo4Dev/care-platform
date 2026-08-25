import {
  integrationInbox,
  newId,
  organizations,
  platformTenants,
  provisioningRetryRequests,
} from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProvisioningRetryConsumer } from './application/provisioning-retry.consumer';

describe('ProvisioningRetryConsumer Inbox delivery', () => {
  let testdb: TestDatabase;
  let consumer: ProvisioningRetryConsumer;
  const retry = vi.fn();
  beforeAll(async () => {
    testdb = await createTestDatabase();
    consumer = new ProvisioningRetryConsumer(testdb.db, { retry } as never);
  });
  beforeEach(() => retry.mockReset());
  afterAll(async () => testdb?.teardown());

  it('claims one durable EventId once and leaves a completed consumer checkpoint', async () => {
    const eventId = newId();
    const organizationId = newId();
    const tenantId = newId();
    const workflowReference = newId();
    const registrationReference = `verified-${newId()}`;
    await testdb.db.insert(organizations).values({ id: organizationId, name: 'Inbox tenant' });
    await testdb.db.insert(platformTenants).values({
      id: tenantId,
      organizationId,
      registrationReference,
      registrationStatus: 'VERIFIED',
      registrationRequestedOrganizationName: 'Inbox tenant',
      registrationOwnerSupabaseSubject: `owner-${newId()}`,
      registrationOwnerEmail: `owner-${newId()}@example.test`,
      registrationOwnerDisplayName: 'Owner',
    });
    await testdb.db.insert(provisioningRetryRequests).values({
      id: workflowReference,
      tenantId,
      registrationReference,
      idempotencyScope: `test:${newId()}`,
      idempotencyKey: newId(),
      requestHash: 'test',
      eventId,
    });
    const event = {
      eventId,
      eventType: 'provisioning.provisioning-retry-requested',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      eventScope: 'TENANT' as const,
      organizationId,
      aggregateType: 'TenantProvisioning',
      aggregateId: newId(),
      aggregateVersion: 1,
      correlationId: newId(),
      causationId: newId(),
      actor: { id: 'platform-operator' },
      payload: { tenantId, workflowReference, registrationReference },
    };
    await consumer.consume(event);
    await consumer.consume(event);
    expect(retry).toHaveBeenCalledTimes(1);
    const [inbox] = await testdb.db
      .select()
      .from(integrationInbox)
      .where(eq(integrationInbox.eventId, eventId));
    expect(inbox).toMatchObject({ status: 'COMPLETED', completedAt: expect.any(Date) });
  });
  it('allows only one concurrent native PostgreSQL claim while a lease is live', async () => {
    const eventId = newId();
    const organizationId = newId();
    const tenantId = newId();
    const workflowReference = newId();
    const registrationReference = `verified-${newId()}`;
    await testdb.db.insert(organizations).values({
      id: organizationId,
      name: 'Concurrent tenant',
    });
    await testdb.db.insert(platformTenants).values({
      id: tenantId,
      organizationId,
      registrationReference,
      registrationStatus: 'VERIFIED',
      registrationRequestedOrganizationName: 'Concurrent tenant',
      registrationOwnerSupabaseSubject: `owner-${newId()}`,
      registrationOwnerEmail: `owner-${newId()}@example.test`,
      registrationOwnerDisplayName: 'Owner',
    });
    await testdb.db.insert(provisioningRetryRequests).values({
      id: workflowReference,
      tenantId,
      registrationReference,
      idempotencyScope: `test:${newId()}`,
      idempotencyKey: newId(),
      requestHash: 'test',
      eventId,
    });
    let release!: () => void;
    retry.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const event = eventFor(
      eventId,
      organizationId,
      tenantId,
      workflowReference,
      registrationReference,
    );
    const first = consumer.consume(event);
    await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    await consumer.consume(event);
    expect(retry).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
  it('does not let an expired claimant acknowledge a replacement lease', async () => {
    const eventId = newId();
    const organizationId = newId();
    const tenantId = newId();
    const workflowReference = newId();
    const registrationReference = `verified-${newId()}`;
    await insertRetryRequest(testdb, {
      eventId,
      organizationId,
      tenantId,
      workflowReference,
      registrationReference,
    });
    let release!: () => void;
    retry.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const event = eventFor(
      eventId,
      organizationId,
      tenantId,
      workflowReference,
      registrationReference,
    );
    const first = consumer.consume(event);
    await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    await testdb.db.execute(sql`
        UPDATE integration.inbox
        SET lease_expires_at = now() - interval '1 second'
      WHERE event_id = ${eventId}::uuid AND consumer = 'provisioning.retry-request.v1'
    `);
    release();
    await expect(first).rejects.toThrow('lease was lost');
    const [inbox] = await testdb.db
      .select()
      .from(integrationInbox)
      .where(eq(integrationInbox.eventId, eventId));
    expect(inbox).toMatchObject({ status: 'PROCESSING', completedAt: null });
  });
  it('does not let an expired claimant release its stale lease after a failed handoff', async () => {
    const eventId = newId();
    const organizationId = newId();
    const tenantId = newId();
    const workflowReference = newId();
    const registrationReference = `verified-${newId()}`;
    await insertRetryRequest(testdb, {
      eventId,
      organizationId,
      tenantId,
      workflowReference,
      registrationReference,
    });
    let reject!: (error: Error) => void;
    retry.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    );
    const event = eventFor(
      eventId,
      organizationId,
      tenantId,
      workflowReference,
      registrationReference,
    );
    const delivery = consumer.consume(event);
    await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    await testdb.db.execute(sql`
      UPDATE integration.inbox
      SET lease_expires_at = now() - interval '1 second'
      WHERE event_id = ${eventId}::uuid AND consumer = 'provisioning.retry-request.v1'
    `);
    reject(new Error('temporary failure'));
    await expect(delivery).rejects.toThrow('temporary failure');
    const [inbox] = await testdb.db
      .select()
      .from(integrationInbox)
      .where(eq(integrationInbox.eventId, eventId));
    expect(inbox).toMatchObject({ status: 'PROCESSING', leaseId: expect.any(String) });
  });
});

async function insertRetryRequest(
  testdb: TestDatabase,
  input: {
    eventId: string;
    organizationId: string;
    tenantId: string;
    workflowReference: string;
    registrationReference: string;
  },
) {
  await testdb.db.insert(organizations).values({ id: input.organizationId, name: 'Lease tenant' });
  await testdb.db.insert(platformTenants).values({
    id: input.tenantId,
    organizationId: input.organizationId,
    registrationReference: input.registrationReference,
    registrationStatus: 'VERIFIED',
    registrationRequestedOrganizationName: 'Lease tenant',
    registrationOwnerSupabaseSubject: `owner-${newId()}`,
    registrationOwnerEmail: `owner-${newId()}@example.test`,
    registrationOwnerDisplayName: 'Owner',
  });
  await testdb.db.insert(provisioningRetryRequests).values({
    id: input.workflowReference,
    tenantId: input.tenantId,
    registrationReference: input.registrationReference,
    idempotencyScope: `test:${newId()}`,
    idempotencyKey: newId(),
    requestHash: 'test',
    eventId: input.eventId,
  });
}

function eventFor(
  eventId: string,
  organizationId: string,
  tenantId: string,
  workflowReference: string,
  registrationReference: string,
) {
  return {
    eventId,
    eventType: 'provisioning.provisioning-retry-requested',
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    eventScope: 'TENANT' as const,
    organizationId,
    aggregateType: 'TenantProvisioning',
    aggregateId: newId(),
    aggregateVersion: 1,
    correlationId: newId(),
    causationId: newId(),
    actor: { id: 'platform-operator' },
    payload: { tenantId, workflowReference, registrationReference },
  };
}
