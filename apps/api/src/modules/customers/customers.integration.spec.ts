import {
  businessCustomers,
  idempotencyOutcomes,
  integrationOutbox,
  newId,
  organizations,
} from '@commerce-platform/database';
import { createTestDatabase as createDb, type TestDatabase } from '@commerce-platform/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CustomerService } from './application/customer.service';
import { CustomerRepository } from './infrastructure/customer.repository';

describe('Customers persistence', () => {
  let testdb: TestDatabase;
  let service: CustomerService;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    testdb = await createDb();
    service = new CustomerService(testdb.db, new CustomerRepository());
    orgA = newId();
    orgB = newId();
    await testdb.db.insert(organizations).values([
      { id: orgA, name: 'Customer A' },
      { id: orgB, name: 'Customer B' },
    ]);
  });
  afterAll(async () => testdb.teardown());

  it('creates, gets, and searches Individual and Business customers only within the organization', async () => {
    const individual = await service.create(
      orgA,
      { type: 'INDIVIDUAL', displayName: 'Alice Walk In' },
      'customer-a-1',
      'actor-a',
      newId(),
    );
    await service.create(
      orgB,
      { type: 'BUSINESS', displayName: 'Alice Foreign', code: 'B-001' },
      'customer-b-1',
      'actor-b',
      newId(),
    );
    expect(await service.get(orgA, individual.id)).toMatchObject({
      type: 'INDIVIDUAL',
      displayName: 'Alice Walk In',
    });
    expect(await service.get(orgB, individual.id)).toBeNull();
    expect((await service.search(orgA, 'Alice', 20)).map((row) => row.organizationId)).toEqual([
      orgA,
    ]);
  });

  it('replays the same idempotent create and rejects a different payload', async () => {
    const key = 'customer-replay';
    const first = await service.create(
      orgA,
      { type: 'BUSINESS', displayName: 'Replay Co', code: 'R-001' },
      key,
      'actor-a',
      newId(),
    );
    const replay = await service.create(
      orgA,
      { type: 'BUSINESS', displayName: 'Replay Co', code: 'R-001' },
      key,
      'actor-a',
      newId(),
    );
    expect(replay.id).toBe(first.id);
    await expect(
      service.create(orgA, { type: 'BUSINESS', displayName: 'Different' }, key, 'actor-a', newId()),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(
      (await testdb.db.select().from(businessCustomers).where(eq(businessCustomers.id, first.id)))
        .length,
    ).toBe(1);
    const [event] = await testdb.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, first.id));
    expect(event.payload).toMatchObject({
      eventType: 'customers.business-customer-created',
      eventScope: 'TENANT',
      organizationId: orgA,
      payload: { customerId: first.id, type: 'BUSINESS' },
    });
    expect(event.payload).not.toHaveProperty('payload.displayName');
    expect(event.payload).not.toHaveProperty('payload.phone');
    expect(event.payload).not.toHaveProperty('payload.email');
    const [outcome] = await testdb.db
      .select()
      .from(idempotencyOutcomes)
      .where(eq(idempotencyOutcomes.idempotencyKey, key));
    expect(outcome.responseJson).not.toHaveProperty('phone');
    expect(outcome.responseJson).not.toHaveProperty('email');
  });

  it('maps a concurrent duplicate customer code to a validation error', async () => {
    const code = `CONCURRENT-${newId().slice(0, 8)}`;
    const results = await Promise.allSettled([
      service.create(
        orgA,
        { type: 'BUSINESS', displayName: 'Concurrent One', code },
        `concurrent-a-${newId()}`,
        'actor-a',
        newId(),
      ),
      service.create(
        orgA,
        { type: 'BUSINESS', displayName: 'Concurrent Two', code },
        `concurrent-b-${newId()}`,
        'actor-a',
        newId(),
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { code: 'VALIDATION_FAILED' },
    });
  });
});
