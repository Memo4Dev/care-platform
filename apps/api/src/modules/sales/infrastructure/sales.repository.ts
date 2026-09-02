import {
  idempotencyOutcomes,
  integrationOutbox,
  newId,
  saleItems,
  sales,
  type SaleItemRow,
  type SaleRow,
} from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';

import { SALES_AGGREGATE_TYPE } from '../domain/events';
import type { DbExecutor } from './db-executor';
import { salesEvent } from './event-envelope';
import { mapPersistenceError } from './persistence-error';

export interface SaleRecord {
  sale: SaleRow;
  items: SaleItemRow[];
}

export interface IdempotencyClaimResult {
  kind: 'claimed' | 'existing';
  claimId: string;
  status?: string;
  requestHash?: string;
  responseJson?: Record<string, unknown> | null;
}

export class SalesRepository {
  async findSale(
    executor: DbExecutor,
    organizationId: string,
    saleId: string,
  ): Promise<SaleRecord | null> {
    const rows = await executor
      .select({ sale: sales, item: saleItems })
      .from(sales)
      .leftJoin(
        saleItems,
        and(eq(saleItems.saleId, sales.id), eq(saleItems.organizationId, sales.organizationId)),
      )
      .where(and(eq(sales.id, saleId), eq(sales.organizationId, organizationId)))
      .orderBy(asc(saleItems.createdAt), asc(saleItems.id));
    if (rows.length === 0) return null;
    return { sale: rows[0].sale, items: rows.flatMap((row) => (row.item ? [row.item] : [])) };
  }

  async lockSale(
    executor: DbExecutor,
    organizationId: string,
    saleId: string,
  ): Promise<SaleRecord | null> {
    const locked = await executor.execute<{ id: string }>(sql`
      SELECT s.id FROM sales.sales AS s
      WHERE s.id = ${saleId}::uuid AND s.organization_id = ${organizationId}::uuid
      FOR UPDATE
    `);
    if (locked.rows.length === 0) return null;
    return this.findSale(executor, organizationId, saleId);
  }

  async createSale(
    executor: DbExecutor,
    data: Omit<SaleRow, 'createdAt' | 'updatedAt'>,
  ): Promise<SaleRow> {
    try {
      const [row] = await executor.insert(sales).values(data).returning();
      return row;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async createSaleItems(
    executor: DbExecutor,
    rows: Omit<SaleItemRow, 'createdAt' | 'updatedAt'>[],
  ): Promise<SaleItemRow[]> {
    try {
      return await executor.insert(saleItems).values(rows).returning();
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async updateSale(
    executor: DbExecutor,
    organizationId: string,
    saleId: string,
    expectedVersion: number,
    values: Partial<SaleRow>,
  ): Promise<SaleRow | null> {
    const updated = await executor
      .update(sales)
      .set({ ...values, updatedAt: new Date(), version: expectedVersion + 1 })
      .where(
        and(
          eq(sales.id, saleId),
          eq(sales.organizationId, organizationId),
          eq(sales.version, expectedVersion),
        ),
      )
      .returning();
    return updated[0] ?? null;
  }

  async nextSaleNumber(executor: DbExecutor, organizationId: string): Promise<string> {
    const result = await executor.execute<{ next_value: string }>(sql`
      INSERT INTO sales.sale_number_counters (organization_id, next_value, created_at, updated_at)
      VALUES (${organizationId}::uuid, 2, now(), now())
      ON CONFLICT (organization_id)
      DO UPDATE SET next_value = sales.sale_number_counters.next_value + 1, updated_at = now()
      RETURNING next_value - 1 AS next_value
    `);
    const value = Number(result.rows[0]?.next_value ?? 1);
    return `SALE-${String(value).padStart(6, '0')}`;
  }

  async claimIdempotency(
    executor: DbExecutor,
    key: string,
    scope: string,
    requestHash: string,
  ): Promise<IdempotencyClaimResult> {
    const id = newId();
    const inserted = await executor
      .insert(idempotencyOutcomes)
      .values({ id, scope, idempotencyKey: key, requestHash, status: 'IN_PROGRESS' })
      .onConflictDoNothing({
        target: [idempotencyOutcomes.scope, idempotencyOutcomes.idempotencyKey],
      })
      .returning({ id: idempotencyOutcomes.id });
    if (inserted.length === 1) return { kind: 'claimed', claimId: id };
    const [existing] = await executor
      .select()
      .from(idempotencyOutcomes)
      .where(and(eq(idempotencyOutcomes.scope, scope), eq(idempotencyOutcomes.idempotencyKey, key)))
      .limit(1);
    if (!existing)
      throw PlatformError.idempotencyConflict('Idempotency claim could not be resolved.');
    return {
      kind: 'existing',
      claimId: existing.id,
      status: existing.status,
      requestHash: existing.requestHash,
      responseJson: existing.responseJson as Record<string, unknown> | null,
    };
  }

  async completeIdempotency(
    executor: DbExecutor,
    claimId: string,
    response: Record<string, unknown>,
  ): Promise<void> {
    await executor
      .update(idempotencyOutcomes)
      .set({ status: 'COMPLETED', responseJson: response, completedAt: new Date() })
      .where(eq(idempotencyOutcomes.id, claimId));
  }

  async findIdempotency(executor: DbExecutor, key: string, scope: string) {
    const [row] = await executor
      .select()
      .from(idempotencyOutcomes)
      .where(and(eq(idempotencyOutcomes.scope, scope), eq(idempotencyOutcomes.idempotencyKey, key)))
      .limit(1);
    return row ?? null;
  }

  async writeEvents(executor: DbExecutor, events: ReturnType<typeof salesEvent>[]): Promise<void> {
    if (events.length === 0) return;
    await executor.insert(integrationOutbox).values(
      events.map((event) => ({
        id: newId(),
        aggregateType: SALES_AGGREGATE_TYPE,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event,
        correlationId: event.correlationId,
        occurredAt: new Date(event.occurredAt),
      })),
    );
  }
}
