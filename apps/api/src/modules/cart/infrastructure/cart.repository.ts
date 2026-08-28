import {
  cartItems,
  carts,
  idempotencyOutcomes,
  integrationOutbox,
  newId,
  type CartItemRow,
  type CartRow,
} from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';

import { CART_AGGREGATE_TYPE, type CartDomainEvent } from '../domain/events';
import type { CartChannel, CartStatus } from '../domain/types';
import type { DbExecutor } from './db-executor';
import { cartEvent, type CartEventType } from './event-envelope';
import { mapPersistenceError } from './persistence-error';

export interface CartRecord {
  cart: CartRow;
  lines: CartItemRow[];
}

/**
 * Cart persistence adapter. Every read/write requires organization scope and
 * aggregate mutations are guarded by the Cart root version.
 */
export class CartRepository {
  async findCart(
    executor: DbExecutor,
    organizationId: string,
    cartId: string,
  ): Promise<CartRecord | null> {
    const rows = await executor
      .select({ cart: carts, line: cartItems })
      .from(carts)
      .leftJoin(
        cartItems,
        and(eq(cartItems.cartId, carts.id), eq(cartItems.organizationId, carts.organizationId)),
      )
      .where(
        and(
          eq(carts.id, cartId),
          eq(carts.organizationId, organizationId),
          eq(carts.channel, 'POS'),
          eq(carts.status, 'DRAFT'),
        ),
      )
      .orderBy(asc(carts.createdAt), asc(carts.id), asc(cartItems.createdAt), asc(cartItems.id));

    if (rows.length === 0) return null;

    return {
      cart: rows[0].cart,
      lines: rows.flatMap((row) => (row.line ? [row.line] : [])),
    };
  }

  /**
   * Locks one tenant-scoped POS Draft Cart root before loading its item rows.
   * All Cart commands serialize through the root version, so this lock keeps a
   * no-op save's version check and returned snapshot consistent until commit.
   */
  async findCartForUpdate(
    executor: DbExecutor,
    organizationId: string,
    cartId: string,
  ): Promise<CartRecord | null> {
    const locked = await executor.execute<{ id: string }>(sql`
      SELECT c.id
        FROM cart.carts AS c
       WHERE c.id = ${cartId}::uuid
         AND c.organization_id = ${organizationId}::uuid
         AND c.channel = 'POS'
         AND c.status = 'DRAFT'
       FOR UPDATE
    `);
    if (locked.rows.length === 0) return null;

    return this.findCart(executor, organizationId, cartId);
  }

  async listCarts(
    executor: DbExecutor,
    organizationId: string,
    branchId: string,
    limit: number,
    after?: string,
  ): Promise<CartListPage> {
    const cursor = after ? decodeCartCursor(after, organizationId, branchId) : null;
    const cursorFilter = cursor
      ? sql`AND (c.created_at, c.id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      : sql.empty();
    const result = await executor.execute<CartListQueryRow>(sql`
      WITH page_carts AS MATERIALIZED (
        SELECT
          c.id,
          c.organization_id,
          c.branch_id,
          c.channel,
          c.status,
          c.customer_id,
          c.created_at,
          c.updated_at,
          c.version,
          c.created_at::text AS cursor_created_at
        FROM cart.carts AS c
        WHERE c.organization_id = ${organizationId}::uuid
          AND c.branch_id = ${branchId}::uuid
          AND c.channel = 'POS'
          AND c.status = 'DRAFT'
          ${cursorFilter}
        ORDER BY c.created_at ASC, c.id ASC
        LIMIT ${limit + 1}
      )
      SELECT
        pc.id AS cart_id,
        pc.organization_id AS cart_organization_id,
        pc.branch_id AS cart_branch_id,
        pc.channel AS cart_channel,
        pc.status AS cart_status,
        pc.customer_id AS cart_customer_id,
        pc.created_at AS cart_created_at,
        pc.updated_at AS cart_updated_at,
        pc.version AS cart_version,
        pc.cursor_created_at,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', ci.id,
              'organizationId', ci.organization_id,
              'cartId', ci.cart_id,
              'variantId', ci.variant_id,
              'unitId', ci.unit_id,
              'quantity', ci.quantity::text,
              'createdAt', ci.created_at,
              'updatedAt', ci.updated_at
            ) ORDER BY ci.created_at ASC, ci.id ASC
          ) FILTER (WHERE ci.id IS NOT NULL),
          '[]'::jsonb
        ) AS lines
      FROM page_carts AS pc
      LEFT JOIN cart.cart_items AS ci
        ON ci.cart_id = pc.id
       AND ci.organization_id = pc.organization_id
      GROUP BY
        pc.id,
        pc.organization_id,
        pc.branch_id,
        pc.channel,
        pc.status,
        pc.customer_id,
        pc.created_at,
        pc.updated_at,
        pc.version,
        pc.cursor_created_at
      ORDER BY pc.created_at ASC, pc.id ASC
    `);

    const rows = result.rows;
    const records = rows.map((row) => ({
      cart: {
        id: row.cart_id,
        organizationId: row.cart_organization_id,
        branchId: row.cart_branch_id,
        channel: row.cart_channel,
        status: row.cart_status,
        customerId: row.cart_customer_id,
        createdAt: new Date(row.cart_created_at),
        updatedAt: new Date(row.cart_updated_at),
        version: row.cart_version,
      },
      lines: row.lines.map((line) => ({
        id: line.id,
        organizationId: line.organizationId,
        cartId: line.cartId,
        variantId: line.variantId,
        unitId: line.unitId,
        quantity: line.quantity,
        createdAt: new Date(line.createdAt),
        updatedAt: new Date(line.updatedAt),
      })),
    }));

    const hasMore = records.length > limit;
    const pageRecords = records.slice(0, limit);
    if (pageRecords.length === 0) return { records: [], nextCursor: null, hasMore: false };

    const lastRow = rows[pageRecords.length - 1];
    return {
      records: pageRecords,
      nextCursor: hasMore
        ? encodeCartCursor(organizationId, branchId, lastRow.cursor_created_at, lastRow.cart_id)
        : null,
      hasMore,
    };
  }

  async createCart(
    executor: DbExecutor,
    data: {
      id: string;
      organizationId: string;
      branchId: string;
      channel: CartChannel;
      status: CartStatus;
      customerId: string | null;
    },
  ): Promise<CartRow> {
    try {
      const [row] = await executor.insert(carts).values(data).returning();
      return row;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async updateCartVersion(
    executor: DbExecutor,
    organizationId: string,
    cartId: string,
    expectedVersion: number,
    nextVersion: number,
  ): Promise<CartRow | null> {
    const updated = await executor
      .update(carts)
      .set({ version: nextVersion, updatedAt: new Date() })
      .where(
        and(
          eq(carts.id, cartId),
          eq(carts.organizationId, organizationId),
          eq(carts.version, expectedVersion),
        ),
      )
      .returning();
    return updated[0] ?? null;
  }

  async createLine(
    executor: DbExecutor,
    data: {
      id: string;
      organizationId: string;
      cartId: string;
      variantId: string;
      unitId: string;
      quantity: string;
    },
  ): Promise<CartItemRow> {
    try {
      const [row] = await executor.insert(cartItems).values(data).returning();
      return row;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async updateLine(
    executor: DbExecutor,
    organizationId: string,
    cartId: string,
    lineId: string,
    quantity: string,
  ): Promise<CartItemRow | null> {
    try {
      const updated = await executor
        .update(cartItems)
        .set({ quantity, updatedAt: new Date() })
        .where(
          and(
            eq(cartItems.id, lineId),
            eq(cartItems.cartId, cartId),
            eq(cartItems.organizationId, organizationId),
          ),
        )
        .returning();
      return updated[0] ?? null;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async deleteLine(
    executor: DbExecutor,
    organizationId: string,
    cartId: string,
    lineId: string,
  ): Promise<boolean> {
    const deleted = await executor
      .delete(cartItems)
      .where(
        and(
          eq(cartItems.id, lineId),
          eq(cartItems.cartId, cartId),
          eq(cartItems.organizationId, organizationId),
        ),
      )
      .returning({ id: cartItems.id });
    return deleted.length > 0;
  }

  async claimIdempotency(
    executor: DbExecutor,
    key: string,
    scope: string,
    requestHash: string,
  ): Promise<IdempotencyClaimResult> {
    const [created] = await executor
      .insert(idempotencyOutcomes)
      .values({
        id: newId(),
        scope,
        idempotencyKey: key,
        requestHash,
        status: 'IN_PROGRESS',
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyOutcomes.id });

    if (created) return { kind: 'claimed', claimId: created.id };

    const [existing] = await executor
      .select()
      .from(idempotencyOutcomes)
      .where(and(eq(idempotencyOutcomes.scope, scope), eq(idempotencyOutcomes.idempotencyKey, key)))
      .limit(1);

    if (!existing) {
      throw new Error('Idempotency claim disappeared before it could be read.');
    }

    return toIdempotencyClaim(existing);
  }

  async findIdempotency(
    executor: DbExecutor,
    key: string,
    scope: string,
  ): Promise<Extract<IdempotencyClaimResult, { kind: 'existing' }> | null> {
    const [existing] = await executor
      .select()
      .from(idempotencyOutcomes)
      .where(and(eq(idempotencyOutcomes.scope, scope), eq(idempotencyOutcomes.idempotencyKey, key)))
      .limit(1);

    return existing ? toIdempotencyClaim(existing) : null;
  }

  async completeIdempotency(
    executor: DbExecutor,
    claimId: string,
    response: unknown,
  ): Promise<void> {
    await executor
      .update(idempotencyOutcomes)
      .set({ status: 'COMPLETED', responseJson: response, completedAt: new Date() })
      .where(eq(idempotencyOutcomes.id, claimId));
  }

  async writeOutbox(
    executor: DbExecutor,
    event: {
      eventType: CartEventType;
      organizationId: string;
      aggregateId: string;
      aggregateVersion: number;
      correlationId: string;
      causationId: string;
      actorId: string;
      payload: Record<string, unknown>;
      occurredAt: Date;
    },
  ): Promise<void> {
    const envelope = cartEvent(event);
    await executor.insert(integrationOutbox).values({
      id: newId(),
      aggregateType: CART_AGGREGATE_TYPE,
      aggregateId: envelope.aggregateId,
      eventType: envelope.eventType,
      payload: envelope,
      correlationId: envelope.correlationId,
      occurredAt: new Date(envelope.occurredAt),
    });
  }

  async writeDomainEvents(
    executor: DbExecutor,
    events: CartDomainEvent[],
    context: {
      correlationId: string;
      causationId: string;
      actorId: string;
    },
  ): Promise<void> {
    for (const event of events) {
      await this.writeOutbox(executor, {
        eventType: eventTypeFor(event),
        organizationId: event.organizationId,
        aggregateId: event.aggregateId,
        aggregateVersion: event.aggregateVersion,
        ...context,
        occurredAt: event.occurredAt,
        payload: payloadFor(event),
      });
    }
  }
}

function eventTypeFor(event: CartDomainEvent): CartEventType {
  switch (event.type) {
    case 'CartCreated':
      return 'cart.cart-created';
    case 'CartLineAdded':
      return 'cart.cart-line-added';
    case 'CartLineUpdated':
      return 'cart.cart-line-updated';
    case 'CartLineRemoved':
      return 'cart.cart-line-removed';
  }
}

function payloadFor(event: CartDomainEvent): Record<string, unknown> {
  switch (event.type) {
    case 'CartCreated':
      return {
        cartId: event.aggregateId,
        branchId: event.branchId,
        channel: event.channel,
        customerId: event.customerId,
      };
    case 'CartLineAdded':
      return {
        cartId: event.aggregateId,
        lineId: event.lineId,
        variantId: event.variantId,
        unitId: event.unitId,
        quantity: event.quantity,
      };
    case 'CartLineUpdated':
      return { cartId: event.aggregateId, lineId: event.lineId, quantity: event.quantity };
    case 'CartLineRemoved':
      return { cartId: event.aggregateId, lineId: event.lineId };
  }
}

export type IdempotencyClaimResult =
  | {
      kind: 'claimed';
      claimId: string;
    }
  | {
      kind: 'existing';
      claimId: string;
      requestHash: string;
      status: string;
      responseJson: Record<string, unknown> | null;
    };

export interface CartListPage {
  records: CartRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface CartListQueryRow extends Record<string, unknown> {
  cart_id: string;
  cart_organization_id: string;
  cart_branch_id: string;
  cart_channel: CartChannel;
  cart_status: CartStatus;
  cart_customer_id: string | null;
  cart_created_at: string;
  cart_updated_at: string;
  cart_version: number;
  cursor_created_at: string;
  lines: CartLineQueryRow[];
}

interface CartLineQueryRow {
  id: string;
  organizationId: string;
  cartId: string;
  variantId: string;
  unitId: string;
  quantity: string;
  createdAt: string;
  updatedAt: string;
}

interface CartCursor {
  organizationId: string;
  branchId: string;
  createdAt: string;
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeCartCursor(
  organizationId: string,
  branchId: string,
  createdAt: string,
  id: string,
): string {
  return Buffer.from(JSON.stringify({ v: 1, organizationId, branchId, createdAt, id })).toString(
    'base64url',
  );
}

function decodeCartCursor(value: string, organizationId: string, branchId: string): CartCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!isRecord(decoded)) throw new Error('cursor shape');
    const createdAtValue = decoded.createdAt;
    const id = decoded.id;
    if (typeof createdAtValue !== 'string') throw new Error('cursor timestamp');
    const createdAt = new Date(createdAtValue);
    if (
      decoded.v !== 1 ||
      decoded.organizationId !== organizationId ||
      decoded.branchId !== branchId ||
      typeof id !== 'string' ||
      !UUID_PATTERN.test(id) ||
      Number.isNaN(createdAt.getTime())
    ) {
      throw new Error('cursor values');
    }
    return { organizationId, branchId, createdAt: createdAtValue, id };
  } catch {
    throw PlatformError.validationFailed('Invalid Cart pagination cursor.', {
      details: { field: 'after' },
    });
  }
}

function toIdempotencyClaim(
  existing: typeof idempotencyOutcomes.$inferSelect,
): Extract<IdempotencyClaimResult, { kind: 'existing' }> {
  return {
    kind: 'existing',
    claimId: existing.id,
    requestHash: existing.requestHash,
    status: existing.status,
    responseJson: isRecord(existing.responseJson) ? existing.responseJson : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
