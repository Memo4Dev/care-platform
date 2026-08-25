import { integrationOutbox, newId } from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { integrationEventEnvelope } from './integration-envelope';
import { OutboxRelayService } from './outbox-relay.service';

describe('OutboxRelayService PostgreSQL claims', () => {
  let testdb: TestDatabase;
  beforeAll(async () => {
    testdb = await createTestDatabase();
  });
  afterAll(async () => testdb?.teardown());

  it('claims a row, publishes its EventId once, then marks publication durable', async () => {
    const id = newId();
    const eventId = newId();
    await testdb.db.insert(integrationOutbox).values({
      id,
      aggregateType: 'Test',
      aggregateId: newId(),
      eventType: 'test.created',
      correlationId: newId(),
      occurredAt: new Date(),
      payload: integrationEventEnvelope({
        eventId,
        eventType: 'test.created',
        eventVersion: 1,
        occurredAt: new Date(),
        eventScope: 'GLOBAL',
        organizationId: null,
        aggregateType: 'Test',
        aggregateId: newId(),
        aggregateVersion: 1,
        correlationId: newId(),
        causationId: newId(),
        actor: { id: 'SYSTEM:test' },
        payload: {},
      }),
    });
    const add = vi.fn().mockResolvedValue({ id: eventId });
    const relay = new OutboxRelayService(testdb.db);
    await expect(relay.relayOnce({ add })).resolves.toBe(1);
    await expect(relay.relayOnce({ add })).resolves.toBe(0);
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0]?.[2]).toMatchObject({ jobId: eventId });
    const [row] = await testdb.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.id, id));
    expect(row).toMatchObject({ publishedAt: expect.any(Date), publishLeaseId: null });
  });

  it('does not let an expired relay lease acknowledge publication', async () => {
    const id = newId();
    const eventId = newId();
    await testdb.db.insert(integrationOutbox).values({
      id,
      aggregateType: 'Test',
      aggregateId: newId(),
      eventType: 'test.created',
      correlationId: newId(),
      occurredAt: new Date(),
      payload: integrationEventEnvelope({
        eventId,
        eventType: 'test.created',
        eventVersion: 1,
        occurredAt: new Date(),
        eventScope: 'GLOBAL',
        organizationId: null,
        aggregateType: 'Test',
        aggregateId: newId(),
        aggregateVersion: 1,
        correlationId: newId(),
        causationId: newId(),
        actor: { id: 'SYSTEM:test' },
        payload: {},
      }),
    });
    const queue = {
      add: async () => {
        await testdb.db.execute(sql`
          UPDATE integration.outbox
          SET publish_lease_expires_at = now() - interval '1 second'
          WHERE id = ${id}::uuid
        `);
      },
    };

    await expect(new OutboxRelayService(testdb.db).relayOnce(queue)).resolves.toBe(1);
    const [row] = await testdb.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.id, id));
    expect(row).toMatchObject({ publishedAt: null, publishLeaseId: expect.any(String) });
  });
});
