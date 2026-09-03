import {
  businessCustomers,
  idempotencyOutcomes,
  integrationOutbox,
  newId,
  type CustomerType,
} from '@commerce-platform/database';
import { and, asc, eq, ilike, or } from 'drizzle-orm';

import type { DbExecutor } from './db-executor';
import { customerEvent } from './event-envelope';
import { mapPersistenceError } from './persistence-error';

export type CustomerRow = typeof businessCustomers.$inferSelect;

export class CustomerRepository {
  async findById(
    executor: DbExecutor,
    organizationId: string,
    id: string,
  ): Promise<CustomerRow | null> {
    const [row] = await executor
      .select()
      .from(businessCustomers)
      .where(
        and(eq(businessCustomers.id, id), eq(businessCustomers.organizationId, organizationId)),
      )
      .limit(1);
    return row ?? null;
  }

  async findByCode(
    executor: DbExecutor,
    organizationId: string,
    code: string,
  ): Promise<CustomerRow | null> {
    const [row] = await executor
      .select()
      .from(businessCustomers)
      .where(
        and(eq(businessCustomers.organizationId, organizationId), eq(businessCustomers.code, code)),
      )
      .limit(1);
    return row ?? null;
  }

  async search(
    executor: DbExecutor,
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<CustomerRow[]> {
    const value = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    return executor
      .select()
      .from(businessCustomers)
      .where(
        and(
          eq(businessCustomers.organizationId, organizationId),
          or(
            ilike(businessCustomers.displayName, value),
            ilike(businessCustomers.code, value),
            ilike(businessCustomers.phone, value),
          ),
        ),
      )
      .orderBy(asc(businessCustomers.displayName))
      .limit(limit);
  }

  async create(
    executor: DbExecutor,
    data: {
      id: string;
      organizationId: string;
      type: CustomerType;
      displayName: string;
      code?: string | null;
      phone?: string | null;
      email?: string | null;
    },
  ): Promise<CustomerRow> {
    try {
      const [row] = await executor.insert(businessCustomers).values(data).returning();
      return row;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async claimIdempotency(executor: DbExecutor, key: string, scope: string, requestHash: string) {
    const [row] = await executor
      .insert(idempotencyOutcomes)
      .values({ id: newId(), scope, idempotencyKey: key, requestHash, status: 'PENDING' })
      .onConflictDoNothing()
      .returning();
    if (row) return { kind: 'new' as const, id: row.id };
    const [existing] = await executor
      .select()
      .from(idempotencyOutcomes)
      .where(and(eq(idempotencyOutcomes.scope, scope), eq(idempotencyOutcomes.idempotencyKey, key)))
      .limit(1);
    return { kind: 'existing' as const, row: existing! };
  }

  async completeIdempotency(executor: DbExecutor, id: string, response: Record<string, unknown>) {
    await executor
      .update(idempotencyOutcomes)
      .set({ status: 'COMPLETED', responseJson: response, completedAt: new Date() })
      .where(eq(idempotencyOutcomes.id, id));
  }

  async writeOutbox(
    executor: DbExecutor,
    organizationId: string,
    customer: CustomerRow,
    actorId: string,
    correlationId: string,
  ) {
    const payload = customerEvent(
      'customers.business-customer-created',
      organizationId,
      customer.id,
      customer.version,
      correlationId,
      actorId,
      { customerId: customer.id, type: customer.type },
    );
    await executor.insert(integrationOutbox).values({
      id: newId(),
      aggregateType: 'BusinessCustomer',
      aggregateId: customer.id,
      eventType: 'customers.business-customer-created',
      correlationId,
      occurredAt: new Date(payload.occurredAt),
      payload,
    });
  }
}
