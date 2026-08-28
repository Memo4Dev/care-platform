import { createHash } from 'node:crypto';

import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import { newId, type DatabaseClient } from '@commerce-platform/database';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../database/database.tokens';
import { CATALOG_CONTRACTS, type CatalogContracts } from '../../catalog/contracts';
import { CUSTOMERS_CONTRACTS, type CustomersContracts } from '../../customers/contracts';
import { normalizeCartView, type CartPage, type CartView } from '../contracts';
import { Cart } from '../domain/cart';
import {
  CartRepository,
  type CartRecord,
  type IdempotencyClaimResult,
} from '../infrastructure/cart.repository';
import type { DbExecutor } from '../infrastructure/db-executor';

interface MutationContext {
  organizationId: string;
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
  requestHash: string;
}

@Injectable()
export class CartService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(CartRepository) private readonly repository: CartRepository,
    @Inject(CATALOG_CONTRACTS) private readonly catalog: CatalogContracts,
    @Inject(CUSTOMERS_CONTRACTS) private readonly customers: CustomersContracts,
  ) {}

  async create(
    input: {
      organizationId: string;
      branchId: string;
      customerId: string | null;
    },
    context: MutationContext,
  ): Promise<CartView> {
    const operation = 'POST:/api/v1/pos/carts';
    const replay = await this.findCompletedReplay(context, operation);
    if (replay) return replay;

    await this.assertCustomerReference(input.organizationId, input.customerId);

    return this.db.transaction(async (tx) => {
      const claim = await this.repository.claimIdempotency(
        tx,
        context.idempotencyKey,
        this.idempotencyScope(context, operation),
        context.requestHash,
      );
      const replay = this.replayIfCompleted(claim, context.requestHash);
      if (replay) return replay;

      const aggregate = Cart.create({
        id: newId(),
        organizationId: input.organizationId,
        branchId: input.branchId,
        channel: 'POS',
        customerId: input.customerId,
      });
      const row = await this.repository.createCart(tx, {
        id: aggregate.id,
        organizationId: aggregate.organizationId,
        branchId: aggregate.branchId,
        channel: aggregate.channel,
        status: aggregate.status,
        customerId: aggregate.customerId,
      });
      await this.repository.writeDomainEvents(tx, aggregate.pullDomainEvents(), {
        correlationId: context.correlationId,
        causationId: context.idempotencyKey,
        actorId: context.actorId,
      });

      const result = toCartView({ cart: row, lines: [] });
      await this.repository.completeIdempotency(tx, claim.claimId, result);
      return result;
    });
  }

  async get(organizationId: string, cartId: string): Promise<CartView | null> {
    const record = await this.repository.findCart(this.db, organizationId, cartId);
    return record ? toCartView(record) : null;
  }

  async list(
    organizationId: string,
    branchId: string,
    limit: number,
    after?: string,
  ): Promise<CartPage> {
    const page = await this.repository.listCarts(this.db, organizationId, branchId, limit, after);
    return {
      items: page.records.map(toCartView),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  async addItem(
    input: {
      organizationId: string;
      cartId: string;
      variantId: string;
      unitId: string;
      quantity: string;
      expectedVersion: number;
    },
    context: MutationContext,
  ): Promise<CartView> {
    const operation = 'POST:/api/v1/pos/carts/:cartId/items';
    const replay = await this.findCompletedReplay(context, operation);
    if (replay) return replay;

    await this.assertSellableVariant(input.organizationId, input.variantId);

    return this.db.transaction(async (tx) => {
      const claim = await this.claim(tx, context, operation);
      const replay = this.replayIfCompleted(claim, context.requestHash);
      if (replay) return replay;

      const record = await this.requireCart(tx, input.organizationId, input.cartId);
      const aggregate = this.reconstitute(record);
      this.assertExpectedVersion(aggregate.id, aggregate.version, input.expectedVersion);
      const existing = record.lines.find(
        (line) => line.variantId === input.variantId && line.unitId === input.unitId,
      );

      aggregate.addLine({
        id: newId(),
        variantId: input.variantId,
        unitId: input.unitId,
        quantity: input.quantity,
      });
      await this.repository
        .updateCartVersion(
          tx,
          input.organizationId,
          input.cartId,
          input.expectedVersion,
          aggregate.version,
        )
        .then((updated) => {
          if (!updated) throw this.versionConflict(input.cartId, input.expectedVersion);
        });
      const event = aggregate.pullDomainEvents();
      const added = event.find((candidate) => candidate.type === 'CartLineAdded');
      if (added?.type !== 'CartLineAdded') throw new Error('CartLineAdded event was not emitted.');

      if (existing) {
        await this.repository.updateLine(
          tx,
          input.organizationId,
          input.cartId,
          existing.id,
          added.quantity,
        );
      } else {
        await this.repository.createLine(tx, {
          id: added.lineId,
          organizationId: input.organizationId,
          cartId: input.cartId,
          variantId: added.variantId,
          unitId: added.unitId,
          quantity: added.quantity,
        });
      }

      const result = await this.persistedCart(tx, input.organizationId, input.cartId);
      await this.repository.writeDomainEvents(tx, event, {
        correlationId: context.correlationId,
        causationId: context.idempotencyKey,
        actorId: context.actorId,
      });
      await this.repository.completeIdempotency(tx, claim.claimId, result);
      return result;
    });
  }

  async updateItem(
    input: {
      organizationId: string;
      cartId: string;
      itemId: string;
      quantity: string;
      expectedVersion: number;
    },
    context: MutationContext,
  ): Promise<CartView> {
    return this.db.transaction(async (tx) => {
      const claim = await this.claim(tx, context, 'PATCH:/api/v1/pos/carts/:cartId/items/:itemId');
      const replay = this.replayIfCompleted(claim, context.requestHash);
      if (replay) return replay;

      // Even a normalized no-op update must serialize on the Cart root. Without
      // the lock, a concurrent mutation could commit after this read and before
      // the durable replay snapshot is stored for the caller's stale If-Match.
      const record = await this.requireCartForUpdate(tx, input.organizationId, input.cartId);
      const aggregate = this.reconstitute(record);
      this.assertExpectedVersion(aggregate.id, aggregate.version, input.expectedVersion);
      aggregate.updateLine(input.itemId, input.quantity);

      if (aggregate.hasPendingChanges) {
        const updated = await this.repository.updateCartVersion(
          tx,
          input.organizationId,
          input.cartId,
          input.expectedVersion,
          aggregate.version,
        );
        if (!updated) throw this.versionConflict(input.cartId, input.expectedVersion);
        const updatedLineState = aggregate.lines.find((line) => line.id === input.itemId);
        if (!updatedLineState) throw PlatformError.notFound('Cart item not found.');
        const updatedLine = await this.repository.updateLine(
          tx,
          input.organizationId,
          input.cartId,
          input.itemId,
          updatedLineState.quantity,
        );
        if (!updatedLine) throw PlatformError.notFound('Cart item not found.');
      }

      const events = aggregate.pullDomainEvents();
      const result = await this.persistedCart(tx, input.organizationId, input.cartId);
      await this.repository.writeDomainEvents(tx, events, {
        correlationId: context.correlationId,
        causationId: context.idempotencyKey,
        actorId: context.actorId,
      });
      await this.repository.completeIdempotency(tx, claim.claimId, result);
      return result;
    });
  }

  async removeItem(
    input: {
      organizationId: string;
      cartId: string;
      itemId: string;
      expectedVersion: number;
    },
    context: MutationContext,
  ): Promise<CartView> {
    return this.db.transaction(async (tx) => {
      const claim = await this.claim(tx, context, 'DELETE:/api/v1/pos/carts/:cartId/items/:itemId');
      const replay = this.replayIfCompleted(claim, context.requestHash);
      if (replay) return replay;

      const record = await this.requireCart(tx, input.organizationId, input.cartId);
      const aggregate = this.reconstitute(record);
      this.assertExpectedVersion(aggregate.id, aggregate.version, input.expectedVersion);
      aggregate.removeLine(input.itemId);

      const updated = await this.repository.updateCartVersion(
        tx,
        input.organizationId,
        input.cartId,
        input.expectedVersion,
        aggregate.version,
      );
      if (!updated) throw this.versionConflict(input.cartId, input.expectedVersion);
      if (
        !(await this.repository.deleteLine(tx, input.organizationId, input.cartId, input.itemId))
      ) {
        throw PlatformError.notFound('Cart item not found.');
      }

      const result = await this.persistedCart(tx, input.organizationId, input.cartId);
      await this.repository.writeDomainEvents(tx, aggregate.pullDomainEvents(), {
        correlationId: context.correlationId,
        causationId: context.idempotencyKey,
        actorId: context.actorId,
      });
      await this.repository.completeIdempotency(tx, claim.claimId, result);
      return result;
    });
  }

  /**
   * LOCAL_ATOMIC save acknowledgement for an already durable Draft Cart.
   *
   * Saving deliberately changes no Cart business state. The root lock keeps the
   * expected-version check and returned item snapshot consistent while the
   * durable HTTP outcome is completed in the same transaction.
   */
  async save(
    input: {
      organizationId: string;
      cartId: string;
      expectedVersion: number;
    },
    context: MutationContext,
  ): Promise<CartView> {
    const operation = 'POST:/api/v1/pos/carts/:cartId/save';
    const replay = await this.findCompletedReplay(context, operation);
    if (replay) return replay;

    return this.db.transaction(async (tx) => {
      const claim = await this.claim(tx, context, operation);
      const replay = this.replayIfCompleted(claim, context.requestHash);
      if (replay) return replay;

      const record = await this.requireCartForUpdate(tx, input.organizationId, input.cartId);
      this.assertExpectedVersion(record.cart.id, record.cart.version, input.expectedVersion);

      const result = toCartView(record);
      await this.repository.completeIdempotency(tx, claim.claimId, result);
      return result;
    });
  }

  private async claim(tx: DbExecutor, context: MutationContext, operation: string) {
    return this.repository.claimIdempotency(
      tx,
      context.idempotencyKey,
      this.idempotencyScope(context, operation),
      context.requestHash,
    );
  }

  private async findCompletedReplay(
    context: MutationContext,
    operation: string,
  ): Promise<CartView | null> {
    const claim = await this.repository.findIdempotency(
      this.db,
      context.idempotencyKey,
      this.idempotencyScope(context, operation),
    );
    return claim ? this.replayIfCompleted(claim, context.requestHash) : null;
  }

  private idempotencyScope(context: MutationContext, operation: string): string {
    return `ORGANIZATION_USER:${context.actorId}:${context.organizationId}:${operation}`;
  }

  private replayIfCompleted(claim: IdempotencyClaimResult, requestHash: string): CartView | null {
    if (claim.kind !== 'existing') return null;
    if (claim.requestHash !== requestHash) {
      throw PlatformError.idempotencyConflict(
        'Idempotency-Key was used with a different Cart request.',
      );
    }
    const replay = claim.responseJson ? normalizeCartView(claim.responseJson) : null;
    if (claim.status === 'COMPLETED' && replay) return replay;
    if (claim.status === 'COMPLETED') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        'The stored Cart mutation outcome is invalid.',
      );
    }
    throw PlatformError.idempotencyConflict('Cart mutation is already in progress.');
  }

  private async assertCustomerReference(
    organizationId: string,
    customerId: string | null,
  ): Promise<void> {
    if (!customerId) return;
    const customer = await this.customers.getCustomer(organizationId, customerId);
    if (!customer || customer.organizationId !== organizationId) {
      throw PlatformError.notFound('Customer reference was not found in this organization.', {
        details: { customerId },
      });
    }
  }

  private async assertSellableVariant(organizationId: string, variantId: string): Promise<void> {
    const result = await this.catalog.validateSellableVariant(organizationId, variantId);
    if (
      result.variant.organizationId !== organizationId ||
      result.variant.status !== 'ACTIVE' ||
      result.productStatus !== 'ACTIVE'
    ) {
      throw PlatformError.of(ERROR_CODES.VARIANT_NOT_SELLABLE, 'Variant is not sellable.', {
        details: {
          variantId,
          variantStatus: result.variant.status,
          productStatus: result.productStatus,
        },
      });
    }
  }

  private async requireCart(
    tx: DbExecutor,
    organizationId: string,
    cartId: string,
  ): Promise<CartRecord> {
    const record = await this.repository.findCart(tx, organizationId, cartId);
    if (!record) {
      throw PlatformError.notFound('Cart was not found.', { details: { cartId } });
    }
    return record;
  }

  private async requireCartForUpdate(
    tx: DbExecutor,
    organizationId: string,
    cartId: string,
  ): Promise<CartRecord> {
    const record = await this.repository.findCartForUpdate(tx, organizationId, cartId);
    if (!record) {
      throw PlatformError.notFound('Cart was not found.', { details: { cartId } });
    }
    return record;
  }

  private reconstitute(record: CartRecord): Cart {
    return Cart.reconstitute({
      id: record.cart.id,
      organizationId: record.cart.organizationId,
      branchId: record.cart.branchId,
      channel: record.cart.channel,
      status: record.cart.status,
      customerId: record.cart.customerId,
      version: record.cart.version,
      lines: record.lines.map((line) => ({
        id: line.id,
        variantId: line.variantId,
        unitId: line.unitId,
        quantity: line.quantity,
      })),
    });
  }

  private async persistedCart(
    tx: DbExecutor,
    organizationId: string,
    cartId: string,
  ): Promise<CartView> {
    const record = await this.requireCart(tx, organizationId, cartId);
    return toCartView(record);
  }

  private assertExpectedVersion(cartId: string, actual: number, expected: number): void {
    if (actual !== expected) throw this.versionConflict(cartId, expected);
  }

  private versionConflict(cartId: string, expectedVersion: number): PlatformError {
    return PlatformError.versionConflict(`Cart ${cartId} was modified concurrently.`, {
      details: { cartId, expectedVersion },
    });
  }
}

function toCartView(record: Pick<CartRecord, 'cart' | 'lines'>): CartView {
  const { cart, lines } = record;
  return {
    id: cart.id,
    organizationId: cart.organizationId,
    branchId: cart.branchId,
    channel: cart.channel,
    status: cart.status,
    customerId: cart.customerId,
    createdAt: cart.createdAt.toISOString(),
    updatedAt: cart.updatedAt.toISOString(),
    version: cart.version,
    items: lines.map((line) => ({
      id: line.id,
      organizationId: line.organizationId,
      cartId: line.cartId,
      variantId: line.variantId,
      unitId: line.unitId,
      quantity: line.quantity,
      createdAt: line.createdAt.toISOString(),
      updatedAt: line.updatedAt.toISOString(),
    })),
  };
}

export function requestHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

/**
 * Produce a deterministic JSON-compatible value for request fingerprints.
 * Object keys are sorted recursively, while array order remains meaningful.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;

  const result = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalize(value[key]);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
