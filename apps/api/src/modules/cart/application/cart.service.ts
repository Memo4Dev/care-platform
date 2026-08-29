import { createHash } from 'node:crypto';

import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import { newId, type CartHoldRow, type DatabaseClient } from '@commerce-platform/database';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../database/database.tokens';
import { CATALOG_CONTRACTS, type CatalogContracts } from '../../catalog/contracts';
import { CUSTOMERS_CONTRACTS, type CustomersContracts } from '../../customers/contracts';
import { INVENTORY_CONTRACTS, type InventoryContracts } from '../../inventory/contracts';
import { ORGANIZATION_CONTRACTS, type OrganizationContracts } from '../../organization/contracts';
import { PRICING_CONTRACTS, type PricingContracts } from '../../pricing/contracts';
import {
  normalizeCartView,
  type CartAvailabilityLineView,
  type CartAvailabilityView,
  type CartPage,
  type CartQuoteLineView,
  type CartQuoteView,
  type CartView,
} from '../contracts';
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
    @Inject(INVENTORY_CONTRACTS) private readonly inventory: InventoryContracts,
    @Inject(ORGANIZATION_CONTRACTS) private readonly organization: OrganizationContracts,
    @Inject(PRICING_CONTRACTS) private readonly pricing: PricingContracts,
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

      const result = toCartView({ cart: row, lines: [] }, null);
      await this.repository.completeIdempotency(tx, claim.claimId, result);
      return result;
    });
  }

  async get(organizationId: string, cartId: string): Promise<CartView | null> {
    const record = await this.repository.findCart(this.db, organizationId, cartId);
    if (!record) return null;
    const hold = await this.repository.findCurrentHold(this.db, organizationId, cartId);
    return toCartView(record, hold);
  }

  /**
   * Live multi-line pricing quote for a POS Draft Cart.
   *
   * Recalculates each line's unit price and total through the Pricing module
   * contract (channel POS, default CASH price type, Cart branch). The result is
   * a read-only projection: it is never persisted and never freezes a price, so
   * a later checkout recomputes through Pricing again. Consistent with the Cart
   * architecture that save/quote never freeze prices.
   */
  async quote(
    organizationId: string,
    cartId: string,
    priceType: 'CASH' | 'WHOLESALE' | 'CREDIT' | 'ONLINE' = 'CASH',
  ): Promise<CartQuoteView> {
    const record = await this.requireCart(this.db, organizationId, cartId);
    const lines: CartQuoteLineView[] = [];
    for (const line of record.lines) {
      const quote = await this.pricing.getPriceQuote(organizationId, {
        variantId: line.variantId,
        unitId: line.unitId,
        priceType,
        channel: 'POS',
        branchId: record.cart.branchId,
      });
      lines.push({
        itemId: line.id,
        variantId: line.variantId,
        unitId: line.unitId,
        quantity: line.quantity,
        unitPrice: quote.amount,
        lineTotal: mulDecimals(quote.amount, line.quantity),
        priceType: priceType,
        source: quote.source,
      });
    }
    const total = lines.reduce((sum, line) => addDecimals(sum, line.lineTotal), '0.00');
    return {
      cartId: record.cart.id,
      cartVersion: record.cart.version,
      branchId: record.cart.branchId,
      priceType,
      lines,
      total,
    };
  }

  /**
   * Non-mutating per-line availability for the Cart against a selected
   * warehouse. Validates the warehouse belongs to the Cart's Organization and
   * branch, then queries Inventory availability for each variant. No
   * reservation or allocation is created.
   */
  async checkAvailability(
    organizationId: string,
    cartId: string,
    warehouseId: string,
  ): Promise<CartAvailabilityView> {
    const record = await this.requireCart(this.db, organizationId, cartId);
    await this.assertWarehouse(organizationId, record.cart.branchId, warehouseId);

    // Convert each line's quantity to the variant's base unit (source of the
    // availability projection) so the comparison and shortage are exact and
    // consistent with the later hold's base-unit demands.
    const demands = await this.resolveBaseDemands(organizationId, record.lines);

    const lines: CartAvailabilityLineView[] = [];
    for (let index = 0; index < record.lines.length; index++) {
      const line = record.lines[index];
      const availability = await this.inventory.getAvailability(
        organizationId,
        warehouseId,
        line.variantId,
      );
      const available = availability ? availability.available : '0.00000000';
      const requested = demands[index]?.quantity ?? line.quantity;
      const shortage = deductDecimals(requested, available);
      lines.push({
        itemId: line.id,
        variantId: line.variantId,
        unitId: line.unitId,
        quantity: requested,
        available,
        shortage,
      });
    }
    return {
      cartId: record.cart.id,
      cartVersion: record.cart.version,
      warehouseId,
      lines,
    };
  }

  async list(
    organizationId: string,
    branchId: string,
    limit: number,
    after?: string,
  ): Promise<CartPage> {
    const page = await this.repository.listCarts(this.db, organizationId, branchId, limit, after);
    return {
      items: page.records.map((record) => toCartView(record, null)),
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

      const record = await this.requireCartForUpdate(tx, input.organizationId, input.cartId);
      await this.assertNoCurrentHold(tx, input.organizationId, input.cartId);
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
      await this.assertNoCurrentHold(tx, input.organizationId, input.cartId);
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

      const record = await this.requireCartForUpdate(tx, input.organizationId, input.cartId);
      await this.assertNoCurrentHold(tx, input.organizationId, input.cartId);
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

      const result = toCartView(
        record,
        await this.repository.findCurrentHold(tx, input.organizationId, input.cartId),
      );
      await this.repository.completeIdempotency(tx, claim.claimId, result);
      return result;
    });
  }

  async hold(
    input: { organizationId: string; cartId: string; warehouseId: string; expectedVersion: number },
    context: MutationContext,
  ): Promise<CartView> {
    const operation = 'POST:/api/v1/pos/carts/:cartId/hold';

    let holdId = '';
    let inventoryRequestHash = '';
    let demands: Array<{ variantId: string; quantity: string }> = [];
    const accepted = await this.db.transaction(async (tx) => {
      const claim = await this.claim(tx, context, operation);
      if (claim.kind === 'existing') {
        if (claim.requestHash !== context.requestHash) {
          throw PlatformError.idempotencyConflict(
            'Idempotency-Key was used with a different Cart request.',
          );
        }
        const replay = this.replayIfCompletedOrNull(claim);
        if (replay) return { replay };
      }
      const record = await this.requireCartForUpdate(tx, input.organizationId, input.cartId);
      this.assertExpectedVersion(record.cart.id, record.cart.version, input.expectedVersion);
      if (record.lines.length === 0) {
        throw PlatformError.validationFailed('Cannot hold an empty Cart.', {
          details: { cartId: input.cartId },
        });
      }
      await this.assertWarehouse(input.organizationId, record.cart.branchId, input.warehouseId);
      demands = await this.resolveBaseDemands(input.organizationId, record.lines);
      let hold: CartHoldRow;
      if (claim.kind === 'existing') {
        const existingHold = await this.repository.findCurrentHoldForUpdate(
          tx,
          input.organizationId,
          input.cartId,
        );
        if (!existingHold || existingHold.causationId !== context.idempotencyKey) {
          throw PlatformError.idempotencyConflict('Cart hold mutation is already in progress.');
        }
        if (existingHold.status === 'ACTIVE' || existingHold.status === 'FAILED') {
          const result = toCartView(record, existingHold);
          await this.repository.completeIdempotency(tx, claim.claimId, result);
          return { replay: result };
        }
        if (existingHold.status !== 'PENDING') {
          throw PlatformError.idempotencyConflict('Cart hold mutation is already in progress.');
        }
        if (
          existingHold.warehouseId !== input.warehouseId ||
          existingHold.cartVersion !== input.expectedVersion
        ) {
          throw PlatformError.idempotencyConflict(
            'Idempotency-Key was used with a different Cart request.',
          );
        }
        hold = existingHold;
        holdId = existingHold.id;
      } else {
        await this.assertNoCurrentHold(tx, input.organizationId, input.cartId);
        const policy = await this.resolveCartHoldPolicy(input.organizationId);
        holdId = newId();
        const expiresAt = new Date(Date.now() + policy.ttlMinutes * 60_000);
        hold = await this.repository.createHold(tx, {
          id: holdId,
          organizationId: input.organizationId,
          cartId: input.cartId,
          branchId: record.cart.branchId,
          warehouseId: input.warehouseId,
          cartVersion: record.cart.version,
          ttlMinutes: policy.ttlMinutes,
          policyVersion: policy.policyVersion,
          expiresAt,
          actorId: context.actorId,
          correlationId: context.correlationId,
          causationId: context.idempotencyKey,
        });
      }
      inventoryRequestHash = requestHash({
        holdId,
        cartId: input.cartId,
        cartVersion: input.expectedVersion,
        warehouseId: input.warehouseId,
        demands,
        expiresAt: hold.expiresAt?.toISOString() ?? null,
      });
      return { record, hold, claimId: claim.claimId };
    });
    if ('replay' in accepted) {
      if (!accepted.replay) throw new Error('Cart hold replay was unexpectedly empty.');
      return accepted.replay;
    }

    const inventory = await this.inventory.createCartReservation({
      organizationId: input.organizationId,
      branchId: accepted.record.cart.branchId,
      warehouseId: input.warehouseId,
      referenceId: holdId,
      cartVersion: input.expectedVersion,
      demands,
      expiresAt: accepted.hold.expiresAt?.toISOString() ?? new Date().toISOString(),
      idempotencyKey: `cart-hold:${holdId}`,
      requestHash: inventoryRequestHash,
      correlationId: context.correlationId,
      causationId: context.idempotencyKey,
      actorId: context.actorId,
    });

    return this.db.transaction(async (tx) => {
      const hold =
        inventory.kind === 'ACTIVE'
          ? await this.repository.completeHold(tx, input.organizationId, holdId, 'ACTIVE', {
              inventoryReservationId: inventory.reservation.reservationId,
            })
          : await this.repository.completeHold(tx, input.organizationId, holdId, 'FAILED', {
              shortages: inventory.shortages,
            });
      const result = toCartView(
        await this.requireCart(tx, input.organizationId, input.cartId),
        hold,
      );
      await this.repository.completeIdempotency(tx, accepted.claimId, result);
      return result;
    });
  }

  async resume(
    input: { organizationId: string; cartId: string; expectedVersion: number },
    context: MutationContext,
  ): Promise<CartView> {
    const operation = 'POST:/api/v1/pos/carts/:cartId/resume';
    const replay = await this.findCompletedReplay(context, operation);
    if (replay) return replay;
    const accepted = await this.db.transaction(async (tx) => {
      const claim = await this.claim(tx, context, operation);
      const replay = this.replayIfCompleted(claim, context.requestHash);
      if (replay) return { replay };
      const record = await this.requireCartForUpdate(tx, input.organizationId, input.cartId);
      this.assertExpectedVersion(record.cart.id, record.cart.version, input.expectedVersion);
      const hold = await this.repository.findCurrentHoldForUpdate(
        tx,
        input.organizationId,
        input.cartId,
      );
      if (!hold) {
        const result = toCartView(record, hold ?? null);
        await this.repository.completeIdempotency(tx, claim.claimId, result);
        return { replay: result };
      }
      const demands = await this.resolveBaseDemands(input.organizationId, record.lines);
      return { record, hold, demands, claimId: claim.claimId };
    });
    if ('replay' in accepted) {
      if (!accepted.replay) throw new Error('Cart resume replay was unexpectedly empty.');
      return accepted.replay;
    }

    const releaseRequest = {
      organizationId: input.organizationId,
      branchId: accepted.record.cart.branchId,
      warehouseId: accepted.hold.warehouseId,
      referenceId: accepted.hold.id,
      cartVersion: accepted.hold.cartVersion,
      idempotencyKey: `cart-resume:${accepted.hold.id}`,
      requestHash: requestHash({ holdId: accepted.hold.id, demands: accepted.demands }),
      correlationId: context.correlationId,
      causationId: context.idempotencyKey,
      actorId: context.actorId,
    };
    const released = await this.inventory.releaseCartReservation(releaseRequest).catch((error) => {
      if (
        accepted.hold.status === 'PENDING' &&
        isErrorCode(error, ERROR_CODES.RESOURCE_NOT_FOUND)
      ) {
        return { kind: 'RELEASED' as const, shortages: [] };
      }
      throw error;
    });

    return this.db.transaction(async (tx) => {
      const finalHold = await this.repository.markHoldReleased(
        tx,
        input.organizationId,
        accepted.hold.id,
        released.kind === 'EXPIRED' ? 'EXPIRED' : 'RELEASED',
        released.shortages,
      );
      const result = toCartView(
        await this.requireCart(tx, input.organizationId, input.cartId),
        finalHold,
      );
      await this.repository.completeIdempotency(tx, accepted.claimId, result);
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

  private replayIfCompletedOrNull(
    claim: Extract<IdempotencyClaimResult, { kind: 'existing' }>,
  ): CartView | null {
    const replay = claim.responseJson ? normalizeCartView(claim.responseJson) : null;
    if (claim.status === 'COMPLETED' && replay) return replay;
    if (claim.status === 'COMPLETED') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        'The stored Cart mutation outcome is invalid.',
      );
    }
    return null;
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

  private async assertNoCurrentHold(tx: DbExecutor, organizationId: string, cartId: string) {
    const hold = await this.repository.findCurrentHoldForUpdate(tx, organizationId, cartId);
    if (hold) {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        'Cart is held and must be resumed before editing.',
        { details: { cartId, holdId: hold.id, status: hold.status } },
      );
    }
  }

  private async assertWarehouse(organizationId: string, branchId: string, warehouseId: string) {
    const warehouse = await this.organization.getWarehouse(organizationId, warehouseId);
    if (
      !warehouse ||
      warehouse.organizationId !== organizationId ||
      warehouse.branchId !== branchId ||
      !warehouse.isActive
    ) {
      throw PlatformError.notFound('Warehouse was not found for this Cart branch.', {
        details: { warehouseId },
      });
    }
  }

  private async resolveCartHoldPolicy(
    organizationId: string,
  ): Promise<{ ttlMinutes: number; policyVersion: number }> {
    const policy = await this.organization.getOrganizationPolicy(organizationId, 'CART');
    const ttl = policy.value.holdReservationTtlMinutes;
    if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 1 || ttl > 1440) {
      throw PlatformError.validationFailed(
        'Cart hold TTL policy must be between 1 and 1440 minutes.',
        {
          details: { policyType: 'CART', field: 'holdReservationTtlMinutes' },
        },
      );
    }
    return { ttlMinutes: ttl, policyVersion: policy.version };
  }

  private async resolveBaseDemands(
    organizationId: string,
    lines: CartRecord['lines'],
  ): Promise<Array<{ variantId: string; quantity: string }>> {
    const demands: Array<{ variantId: string; quantity: string }> = [];
    for (const line of lines) {
      const variant = await this.catalog.getVariant(organizationId, line.variantId);
      if (!variant)
        throw PlatformError.notFound('Variant was not found.', {
          details: { variantId: line.variantId },
        });
      demands.push({
        variantId: line.variantId,
        quantity:
          line.unitId === variant.baseUnitId
            ? line.quantity
            : await this.catalog.convertUnit(
                organizationId,
                line.unitId,
                variant.baseUnitId,
                line.quantity,
              ),
      });
    }
    return demands;
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
    return toCartView(record, await this.repository.findCurrentHold(tx, organizationId, cartId));
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

function toCartView(
  record: Pick<CartRecord, 'cart' | 'lines'>,
  hold: CartHoldRow | null,
): CartView {
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
    hold: hold
      ? {
          id: hold.id,
          status: hold.status,
          warehouseId: hold.warehouseId,
          cartVersion: hold.cartVersion,
          ttlMinutes: hold.ttlMinutes,
          policyVersion: hold.policyVersion,
          expiresAt: hold.expiresAt?.toISOString() ?? null,
          shortages: Array.isArray(hold.shortagesJson) ? (hold.shortagesJson as never[]) : [],
        }
      : null,
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

function isErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

// ---------------------------------------------------------------------------
// Money / quantity decimal arithmetic.
//
// Prices are stored as decimal strings (e.g. "12.3400"); line quantities use
// the Cart NUMERIC(14,8) representation. Multiplication/addition/subtraction
// below use integer core math on the 8-decimal scale so correctness-critical
// money totals never pass through a floating-point value.
// ---------------------------------------------------------------------------

const MONEY_SCALE = 100_000_000n; // 8 fractional places used by Cart quantities

/** multiply a price (≥0) by a positive quantity using integer math. */
function mulDecimals(price: string, quantity: string): string {
  const pScaled = toScaledNonNegative(price);
  const qScaled = toScaledNonNegative(quantity);
  const result = (pScaled * qScaled) / MONEY_SCALE;
  return formatScaledNonNegative(result);
}

/** sum two non-negative decimal strings using integer math. */
function addDecimals(left: string, right: string): string {
  return formatScaledNonNegative(toScaledNonNegative(left) + toScaledNonNegative(right));
}

/** right subtracted from left, clamped at zero using integer math. */
function deductDecimals(left: string, right: string): string {
  const diff = toScaledNonNegative(left) - toScaledNonNegative(right);
  return formatScaledNonNegative(diff > 0n ? diff : 0n);
}

function toScaledNonNegative(value: string): bigint {
  const normalized = String(value).trim();
  const [whole, fraction = ''] = normalized.split('.');
  // Keep any sign embedded in the whole part so it is applied exactly once
  // (a sign applied both here and via a separate multiplier would flip
  // negatives into a positive corruption). The result is clamped to zero so
  // the "non-negative" contract always holds.
  const wholePart = whole === '' || whole === '-' ? '0' : whole;
  const fractionSign = wholePart.startsWith('-') ? -1n : 1n;
  const scaled =
    BigInt(wholePart === '' ? '0' : wholePart) * MONEY_SCALE +
    BigInt(fraction.padEnd(8, '0').slice(0, 8)) * fractionSign;
  return scaled < 0n ? 0n : scaled;
}

function formatScaledNonNegative(value: bigint): string {
  const safe = value < 0n ? 0n : value;
  const whole = safe / MONEY_SCALE;
  const fraction = (safe % MONEY_SCALE).toString().padStart(8, '0');
  return `${whole}.${fraction}`;
}
