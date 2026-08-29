import {
  branches,
  cartItems,
  cartHolds,
  carts,
  integrationOutbox,
  idempotencyOutcomes,
  newId,
  organizations,
  productVariants,
  products,
  unitDefinitions,
  warehouses,
} from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { CatalogContracts, SellableVariantView } from '../catalog/contracts';
import type { CustomersContracts } from '../customers/contracts';
import type { InventoryContracts } from '../inventory/contracts';
import type { OrganizationContracts } from '../organization/contracts';
import type { PricingContracts } from '../pricing/contracts';
import { CartService, requestHash } from './application/cart.service';
import { CartRepository } from './infrastructure/cart.repository';

describe('Cart persistence', () => {
  let testdb: TestDatabase;
  let service: CartService;
  let orgA: string;
  let orgB: string;
  let branchA: string;
  let branchB: string;
  let unitA: string;
  let unitB: string;
  let variantA: string;
  let variantB: string;
  let warehouseA: string;
  let inventory: InventoryContracts;
  let organization: OrganizationContracts;
  let pricing: PricingContracts;

  const actorId = newId();

  function context(idempotencyKey: string, payload: unknown) {
    return {
      organizationId: orgA,
      actorId,
      correlationId: `correlation-${idempotencyKey}`,
      idempotencyKey,
      requestHash: requestHash(payload),
    };
  }

  async function createRawCart(
    branchId = branchA,
    createdAt = new Date(),
    channel: 'ONLINE' | 'POS' | 'SALES' = 'POS',
  ): Promise<string> {
    const cartId = newId();
    await testdb.client.query(
      `INSERT INTO cart.carts
         (id, organization_id, branch_id, channel, status, customer_id, created_at, updated_at, version)
       VALUES ($1, $2, $3, $4, 'DRAFT', NULL, $5, $5, 1)`,
      [cartId, orgA, branchId, channel, createdAt],
    );
    return cartId;
  }

  async function insertRawLine(cartId: string, quantity: string) {
    return testdb.client.query(
      `INSERT INTO cart.cart_items
         (id, organization_id, cart_id, variant_id, unit_id, quantity)
       VALUES ($1, $2, $3, $4, $5, $6::numeric)
        RETURNING id, quantity`,
      [newId(), orgA, cartId, variantA, unitA, quantity],
    );
  }

  beforeAll(async () => {
    testdb = await createTestDatabase();
    orgA = newId();
    orgB = newId();
    branchA = newId();
    branchB = newId();
    unitA = newId();
    unitB = newId();
    variantA = newId();
    variantB = newId();
    warehouseA = newId();

    await testdb.db.insert(organizations).values([
      { id: orgA, name: 'Cart A' },
      { id: orgB, name: 'Cart B' },
    ]);
    await testdb.db.insert(branches).values([
      { id: branchA, organizationId: orgA, code: 'A', name: 'Branch A' },
      { id: branchB, organizationId: orgB, code: 'B', name: 'Branch B' },
    ]);
    await testdb.db.insert(warehouses).values({
      id: warehouseA,
      organizationId: orgA,
      branchId: branchA,
      code: 'MAIN',
      name: 'Main Warehouse',
    });
    await testdb.db.insert(unitDefinitions).values([
      { id: unitA, organizationId: orgA, name: 'Piece A', symbol: 'pc' },
      { id: unitB, organizationId: orgB, name: 'Piece B', symbol: 'pc' },
    ]);
    const productA = newId();
    const productB = newId();
    await testdb.db.insert(products).values([
      { id: productA, organizationId: orgA, name: 'Product A', status: 'ACTIVE' },
      { id: productB, organizationId: orgB, name: 'Product B', status: 'ACTIVE' },
    ]);
    await testdb.db.insert(productVariants).values([
      {
        id: variantA,
        organizationId: orgA,
        productId: productA,
        name: 'Variant A',
        sku: 'SKU-A',
        baseUnitId: unitA,
        status: 'ACTIVE',
      },
      {
        id: variantB,
        organizationId: orgB,
        productId: productB,
        name: 'Variant B',
        sku: 'SKU-B',
        baseUnitId: unitB,
        status: 'ACTIVE',
      },
    ]);

    const catalog: CatalogContracts = {
      getProduct: async () => null,
      getVariant: async (organizationId, variantId) => ({
        id: variantId,
        organizationId,
        productId: newId(),
        name: 'Variant',
        sku: 'SKU',
        barcode: null,
        baseUnitId: unitA,
        categoryId: null,
        status: 'ACTIVE',
        version: 1,
      }),
      resolveBarcode: async () => null,
      convertUnit: async () => '1',
      validateSellableVariant: async (organizationId, variantId) =>
        sellableVariant(variantId === variantB ? orgB : organizationId, variantId),
    };
    const customers: CustomersContracts = {
      getCustomer: async () => null,
      searchCustomers: async () => [],
    };
    inventory = {
      getAvailability: async () => null,
      receiveStock: async () => ({ stockPositionId: newId() }),
      createCartReservation: async (input) => ({
        kind: 'ACTIVE',
        shortages: [],
        reservation: {
          reservationId: newId(),
          organizationId: input.organizationId,
          branchId: input.branchId,
          warehouseId: input.warehouseId,
          referenceId: input.referenceId,
          cartVersion: input.cartVersion,
          status: 'ACTIVE',
          expiresAt: input.expiresAt,
          items: input.demands.map((demand) => ({
            stockPositionId: newId(),
            variantId: demand.variantId,
            quantity: demand.quantity,
            onHand: '10.00000000',
            reserved: demand.quantity,
            allocated: '0.00000000',
            available: '9.00000000',
          })),
        },
      }),
      releaseCartReservation: async (input) => ({
        kind: 'RELEASED',
        shortages: [],
        reservation: {
          reservationId: newId(),
          organizationId: input.organizationId,
          branchId: input.branchId,
          warehouseId: input.warehouseId,
          referenceId: input.referenceId,
          cartVersion: input.cartVersion,
          status: 'RELEASED',
          expiresAt: null,
          items: [],
        },
      }),
      checkCartReservation: async (input) => ({
        kind: 'ACTIVE',
        shortages: [],
        reservation: {
          reservationId: newId(),
          organizationId: input.organizationId,
          branchId: input.branchId,
          warehouseId: input.warehouseId,
          referenceId: input.referenceId,
          cartVersion: input.cartVersion,
          status: 'ACTIVE',
          expiresAt: null,
          items: [],
        },
      }),
    };
    organization = {
      getBranch: async () => null,
      getBranchPriority: async () => 0,
      getWarehouse: async (organizationId, warehouseId) =>
        warehouseId === warehouseA
          ? {
              id: warehouseA,
              organizationId,
              branchId: branchA,
              code: 'MAIN',
              name: 'Main Warehouse',
              isActive: true,
              version: 1,
            }
          : null,
      getOrganizationPolicy: async (organizationId, policyType) => ({
        organizationId,
        policyType,
        value: { holdReservationTtlMinutes: 15 },
        version: 0,
        source: 'default',
      }),
    };
    pricing = {
      getPriceQuote: async (_organizationId, input) => ({
        amount: '10.00000000',
        priceType: input.priceType,
        channel: 'POS',
        source: 'ORGANIZATIONAL',
      }),
      validateCoupon: async () => {
        throw new Error('not used');
      },
      evaluatePromotion: async () => {
        throw new Error('not used');
      },
      calculateTaxPricingResult: async () => {
        throw new Error('not used');
      },
    };
    service = new CartService(
      testdb.db,
      new CartRepository(),
      catalog,
      customers,
      inventory,
      organization,
      pricing,
    );
  });

  afterAll(async () => testdb?.teardown());

  it('creates, reopens, modifies, and removes Draft lines with decimal quantities', async () => {
    const created = await service.create(
      { organizationId: orgA, branchId: branchA, customerId: null },
      context('create-cart', { branchId: branchA }),
    );
    expect(created).toMatchObject({
      organizationId: orgA,
      branchId: branchA,
      channel: 'POS',
      version: 1,
    });

    const firstItem = await service.addItem(
      {
        organizationId: orgA,
        cartId: created.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '0.1',
        expectedVersion: 1,
      },
      context('add-line-1', {
        cartId: created.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '0.1',
        expectedVersion: 1,
      }),
    );
    expect(firstItem.version).toBe(2);
    expect(firstItem.items[0]?.quantity).toBe('0.10000000');

    const merged = await service.addItem(
      {
        organizationId: orgA,
        cartId: created.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '0.2',
        expectedVersion: 2,
      },
      context('add-line-2', {
        cartId: created.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '0.2',
        expectedVersion: 2,
      }),
    );
    expect(merged.version).toBe(3);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]?.quantity).toBe('0.30000000');

    const updated = await service.updateItem(
      {
        organizationId: orgA,
        cartId: created.id,
        itemId: merged.items[0]!.id,
        quantity: '2.5',
        expectedVersion: 3,
      },
      context('update-line', {
        cartId: created.id,
        itemId: merged.items[0]!.id,
        quantity: '2.5',
        expectedVersion: 3,
      }),
    );
    expect(updated.version).toBe(4);
    expect(updated.items[0]?.quantity).toBe('2.50000000');

    const removed = await service.removeItem(
      {
        organizationId: orgA,
        cartId: created.id,
        itemId: merged.items[0]!.id,
        expectedVersion: 4,
      },
      context('remove-line', {
        cartId: created.id,
        itemId: merged.items[0]!.id,
        expectedVersion: 4,
      }),
    );
    expect(removed.version).toBe(5);
    expect(removed.items).toEqual([]);

    expect(await service.get(orgB, created.id)).toBeNull();
    expect(
      (
        await testdb.db
          .select()
          .from(cartItems)
          .where(and(eq(cartItems.organizationId, orgA), eq(cartItems.cartId, created.id)))
      ).length,
    ).toBe(0);
  });

  it('replays matching idempotency keys and rejects changed requests', async () => {
    const input = { branchId: branchA };
    const key = 'cart-create-replay';
    const first = await service.create(
      { organizationId: orgA, branchId: branchA, customerId: null },
      context(key, input),
    );
    const replay = await service.create(
      { organizationId: orgA, branchId: branchA, customerId: null },
      context(key, input),
    );
    expect(replay.id).toBe(first.id);
    await expect(
      service.create(
        { organizationId: orgA, branchId: branchB, customerId: null },
        context(key, { branchId: branchB }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const [outcome] = await testdb.db
      .select()
      .from(idempotencyOutcomes)
      .where(eq(idempotencyOutcomes.idempotencyKey, key));
    expect(outcome?.status).toBe('COMPLETED');
    expect(outcome?.responseJson).toMatchObject({ id: first.id, organizationId: orgA });
  });

  it('rejects a duplicate for a durable IN_PROGRESS create without mutating Cart state', async () => {
    const key = `cart-in-progress-${newId()}`;
    const payload = { branchId: branchA };
    const mutation = context(key, payload);
    const scope = `ORGANIZATION_USER:${actorId}:${orgA}:POST:/api/v1/pos/carts`;
    await testdb.db.insert(idempotencyOutcomes).values({
      id: newId(),
      scope,
      idempotencyKey: key,
      requestHash: mutation.requestHash,
      status: 'IN_PROGRESS',
    });
    const beforeCarts = await testdb.db
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.organizationId, orgA));

    await expect(
      service.create({ organizationId: orgA, branchId: branchA, customerId: null }, mutation),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Cart mutation is already in progress.',
    });

    const afterCarts = await testdb.db
      .select({ id: carts.id })
      .from(carts)
      .where(eq(carts.organizationId, orgA));
    const [outcome] = await testdb.db
      .select({
        status: idempotencyOutcomes.status,
        responseJson: idempotencyOutcomes.responseJson,
      })
      .from(idempotencyOutcomes)
      .where(
        and(eq(idempotencyOutcomes.scope, scope), eq(idempotencyOutcomes.idempotencyKey, key)),
      );
    const outbox = await testdb.db
      .select({ id: integrationOutbox.id })
      .from(integrationOutbox)
      .where(eq(integrationOutbox.correlationId, mutation.correlationId));

    expect(afterCarts).toHaveLength(beforeCarts.length);
    expect(new Set(afterCarts.map((cart) => cart.id))).toEqual(
      new Set(beforeCarts.map((cart) => cart.id)),
    );
    expect(outcome).toEqual({ status: 'IN_PROGRESS', responseJson: null });
    expect(outbox).toHaveLength(0);
  });

  it('rolls back the claim, Cart version, line state, and outbox when line persistence fails', async () => {
    const created = await service.create(
      { organizationId: orgA, branchId: branchA, customerId: null },
      context(`rollback-create-${newId()}`, { branchId: branchA }),
    );
    const added = await service.addItem(
      {
        organizationId: orgA,
        cartId: created.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '1',
        expectedVersion: 1,
      },
      context(`rollback-valid-line-${newId()}`, {
        cartId: created.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '1',
        expectedVersion: 1,
      }),
    );
    const failedKey = `rollback-failed-line-${newId()}`;
    const failedUnitId = newId();
    const failedPayload = {
      cartId: created.id,
      variantId: variantA,
      unitId: failedUnitId,
      quantity: '2',
      expectedVersion: added.version,
    };

    await expect(
      service.addItem(
        {
          organizationId: orgA,
          cartId: created.id,
          variantId: variantA,
          unitId: failedUnitId,
          quantity: '2',
          expectedVersion: added.version,
        },
        context(failedKey, failedPayload),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { reference: 'unitId' },
    });

    const [cart] = await testdb.db
      .select({ version: carts.version })
      .from(carts)
      .where(eq(carts.id, created.id));
    const lines = await testdb.db
      .select({
        variantId: cartItems.variantId,
        unitId: cartItems.unitId,
        quantity: cartItems.quantity,
      })
      .from(cartItems)
      .where(eq(cartItems.cartId, created.id));
    const events = await testdb.db
      .select({ eventType: integrationOutbox.eventType })
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, created.id));
    const failedOutcomes = await testdb.db
      .select({ id: idempotencyOutcomes.id })
      .from(idempotencyOutcomes)
      .where(
        and(
          eq(
            idempotencyOutcomes.scope,
            `ORGANIZATION_USER:${actorId}:${orgA}:POST:/api/v1/pos/carts/:cartId/items`,
          ),
          eq(idempotencyOutcomes.idempotencyKey, failedKey),
        ),
      );

    expect(cart?.version).toBe(added.version);
    expect(lines).toEqual([{ variantId: variantA, unitId: unitA, quantity: '1.00000000' }]);
    expect(events.map((event) => event.eventType).sort()).toEqual([
      'cart.cart-created',
      'cart.cart-line-added',
    ]);
    expect(failedOutcomes).toHaveLength(0);
  });

  it('binds expected versions into add, update, and remove line idempotency', async () => {
    const cart = await service.create(
      { organizationId: orgA, branchId: branchA, customerId: null },
      context('line-idempotency-cart', { branchId: branchA }),
    );
    const linePayload = {
      cartId: cart.id,
      variantId: variantA,
      unitId: unitA,
      quantity: '1',
      expectedVersion: 1,
    };
    const added = await service.addItem(
      { organizationId: orgA, cartId: cart.id, ...linePayload },
      context('line-idempotency-add', linePayload),
    );
    const addedReplay = await service.addItem(
      { organizationId: orgA, cartId: cart.id, ...linePayload },
      context('line-idempotency-add', linePayload),
    );
    expect(addedReplay).toEqual(added);
    await expect(
      service.addItem(
        { organizationId: orgA, cartId: cart.id, ...linePayload, expectedVersion: 2 },
        context('line-idempotency-add', { ...linePayload, expectedVersion: 2 }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const itemId = added.items[0]!.id;
    const updatePayload = {
      cartId: cart.id,
      itemId,
      quantity: '2',
      expectedVersion: 2,
    };
    const updated = await service.updateItem(
      { organizationId: orgA, ...updatePayload },
      context('line-idempotency-update', updatePayload),
    );
    expect(
      await service.updateItem(
        { organizationId: orgA, ...updatePayload },
        context('line-idempotency-update', updatePayload),
      ),
    ).toEqual(updated);
    await expect(
      service.updateItem(
        { organizationId: orgA, ...updatePayload, expectedVersion: 3 },
        context('line-idempotency-update', { ...updatePayload, expectedVersion: 3 }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    const removePayload = { cartId: cart.id, itemId, expectedVersion: 3 };
    const removed = await service.removeItem(
      { organizationId: orgA, ...removePayload },
      context('line-idempotency-remove', removePayload),
    );
    expect(
      await service.removeItem(
        { organizationId: orgA, ...removePayload },
        context('line-idempotency-remove', removePayload),
      ),
    ).toEqual(removed);
    await expect(
      service.removeItem(
        { organizationId: orgA, ...removePayload, expectedVersion: 4 },
        context('line-idempotency-remove', { ...removePayload, expectedVersion: 4 }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('enforces optimistic version and same-tenant foreign keys', async () => {
    const cart = await service.create(
      { organizationId: orgA, branchId: branchA, customerId: null },
      context('cas-cart', { branchId: branchA }),
    );
    await expect(
      service.addItem(
        {
          organizationId: orgA,
          cartId: cart.id,
          variantId: variantA,
          unitId: unitA,
          quantity: '1',
          expectedVersion: 0,
        },
        context('cas-line', { cartId: cart.id, expectedVersion: 0 }),
      ),
    ).rejects.toMatchObject({
      code: 'RESOURCE_VERSION_CONFLICT',
      details: { cartId: cart.id, expectedVersion: 0 },
    });

    await expect(
      service.addItem(
        {
          organizationId: orgA,
          cartId: cart.id,
          variantId: variantB,
          unitId: unitB,
          quantity: '1',
          expectedVersion: 1,
        },
        context('foreign-line', {
          cartId: cart.id,
          variantId: variantB,
          unitId: unitB,
          quantity: '1',
          expectedVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'VARIANT_NOT_SELLABLE' });

    const concurrent = await Promise.allSettled([
      service.addItem(
        {
          organizationId: orgA,
          cartId: cart.id,
          variantId: variantA,
          unitId: unitA,
          quantity: '1',
          expectedVersion: 1,
        },
        context('concurrent-line-a', {
          cartId: cart.id,
          variantId: variantA,
          unitId: unitA,
          quantity: '1',
          expectedVersion: 1,
        }),
      ),
      service.addItem(
        {
          organizationId: orgA,
          cartId: cart.id,
          variantId: variantA,
          unitId: unitA,
          quantity: '2',
          expectedVersion: 1,
        },
        context('concurrent-line-b', {
          cartId: cart.id,
          variantId: variantA,
          unitId: unitA,
          quantity: '2',
          expectedVersion: 1,
        }),
      ),
    ]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.find((result) => result.status === 'rejected')).toMatchObject({
      status: 'rejected',
      reason: { code: 'RESOURCE_VERSION_CONFLICT' },
    });

    await expect(
      testdb.db.insert(cartItems).values({
        id: newId(),
        organizationId: orgA,
        cartId: cart.id,
        variantId: variantB,
        unitId: unitB,
        quantity: '1',
      }),
    ).rejects.toThrow();

    await expect(
      testdb.db.insert(cartItems).values({
        id: newId(),
        organizationId: orgA,
        cartId: cart.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '0',
      }),
    ).rejects.toThrow();

    expect((await testdb.db.select().from(carts).where(eq(carts.id, cart.id))).length).toBe(1);
  });

  it('rejects NaN and values above the NUMERIC(14,8) maximum while accepting the boundary', async () => {
    const nanCartId = await createRawCart();
    await expect(insertRawLine(nanCartId, 'NaN')).rejects.toMatchObject({ code: '23514' });

    const overLimitCartId = await createRawCart();
    await expect(insertRawLine(overLimitCartId, '1000000')).rejects.toMatchObject({
      code: '22003',
    });

    const maximumCartId = await createRawCart();
    const maximum = await insertRawLine(maximumCartId, '999999.99999999');
    expect(maximum.rows[0]?.quantity).toBe('999999.99999999');
  });

  it('keeps the unit tenant FK and its supporting child index in PostgreSQL', async () => {
    const constraints = await testdb.client.query<{ conname: string; definition: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'cart.cart_items'::regclass
          AND conname IN ('cart_items_quantity_finite_max_check', 'cart_items_unit_tenant_fk')
        ORDER BY conname`,
    );
    const quantityConstraint = constraints.rows.find(
      (constraint) => constraint.conname === 'cart_items_quantity_finite_max_check',
    );
    const unitForeignKey = constraints.rows.find(
      (constraint) => constraint.conname === 'cart_items_unit_tenant_fk',
    );

    expect(quantityConstraint?.definition).toContain('999999.99999999');
    expect(quantityConstraint?.definition).not.toContain('NaN');
    expect(quantityConstraint?.definition).not.toContain('Infinity');
    expect(unitForeignKey?.definition).toContain('FOREIGN KEY (unit_id, organization_id)');
    expect(unitForeignKey?.definition).toContain('catalog.unit_definitions');

    const branchForeignKey = await testdb.client.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'cart.carts'::regclass
          AND conname = 'carts_branch_tenant_fk'`,
    );
    expect(branchForeignKey.rows[0]?.definition).toContain(
      'FOREIGN KEY (branch_id, organization_id)',
    );
    expect(branchForeignKey.rows[0]?.definition).toContain('ON DELETE CASCADE');

    const indexes = await testdb.client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef
         FROM pg_indexes
        WHERE schemaname = 'cart'
          AND tablename = 'cart_items'
          AND indexname = 'cart_items_unit_id_idx'`,
    );
    expect(indexes.rows).toHaveLength(1);
    expect(indexes.rows[0]?.indexdef).toMatch(/\(unit_id, organization_id\)/);
  });

  it('returns a cart with all lines from one consistent repository view', async () => {
    const repository = new CartRepository();
    const cartId = await createRawCart();
    const secondUnitId = newId();
    await testdb.db.insert(unitDefinitions).values({
      id: secondUnitId,
      organizationId: orgA,
      name: `Cart View Unit ${secondUnitId.slice(0, 8)}`,
      symbol: `cv-${secondUnitId.slice(0, 8)}`,
    });

    const firstLine = await repository.createLine(testdb.db, {
      id: newId(),
      organizationId: orgA,
      cartId,
      variantId: variantA,
      unitId: unitA,
      quantity: '1.25',
    });
    const secondLine = await repository.createLine(testdb.db, {
      id: newId(),
      organizationId: orgA,
      cartId,
      variantId: variantA,
      unitId: secondUnitId,
      quantity: '2.5',
    });

    const querySpy = vi.spyOn(testdb.client, 'query');
    let record: Awaited<ReturnType<CartRepository['findCart']>>;
    try {
      record = await repository.findCart(testdb.db, orgA, cartId);
      expect(querySpy).toHaveBeenCalledTimes(1);
    } finally {
      querySpy.mockRestore();
    }

    expect(record?.cart.id).toBe(cartId);
    expect(record?.lines).toHaveLength(2);
    const linesById = new Map(record?.lines.map((line) => [line.id, line]));
    expect(linesById.get(firstLine.id)?.quantity).toBe('1.25000000');
    expect(linesById.get(secondLine.id)?.quantity).toBe('2.50000000');
  });

  it('paginates POS Draft carts with one snapshot query for each cart page', async () => {
    const repository = new CartRepository();
    const listBranchId = newId();
    await testdb.db.insert(branches).values({
      id: listBranchId,
      organizationId: orgA,
      code: `LIST-${listBranchId.slice(0, 8)}`,
      name: 'Cart list branch',
    });

    const oldestCartId = await createRawCart(listBranchId, new Date('2026-01-01T00:00:00.000Z'));
    const middleCartId = await createRawCart(listBranchId, new Date('2026-01-02T00:00:00.000Z'));
    const newestCartId = await createRawCart(listBranchId, new Date('2026-01-03T00:00:00.000Z'));

    await repository.createLine(testdb.db, {
      id: newId(),
      organizationId: orgA,
      cartId: oldestCartId,
      variantId: variantA,
      unitId: unitA,
      quantity: '1',
    });
    const middleLine = await repository.createLine(testdb.db, {
      id: newId(),
      organizationId: orgA,
      cartId: middleCartId,
      variantId: variantA,
      unitId: unitA,
      quantity: '2',
    });
    await repository.createLine(testdb.db, {
      id: newId(),
      organizationId: orgA,
      cartId: newestCartId,
      variantId: variantA,
      unitId: unitA,
      quantity: '3',
    });

    const querySpy = vi.spyOn(testdb.client, 'query');
    let firstPage: Awaited<ReturnType<CartRepository['listCarts']>>;
    let secondPage: Awaited<ReturnType<CartRepository['listCarts']>>;
    try {
      firstPage = await repository.listCarts(testdb.db, orgA, listBranchId, 1);
      secondPage = await repository.listCarts(
        testdb.db,
        orgA,
        listBranchId,
        1,
        firstPage.nextCursor ?? undefined,
      );
      expect(querySpy).toHaveBeenCalledTimes(2);
    } finally {
      querySpy.mockRestore();
    }

    expect(firstPage.records).toHaveLength(1);
    expect(firstPage.records[0]?.cart.id).toBe(oldestCartId);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.records).toHaveLength(1);
    expect(secondPage.records[0]?.cart.id).toBe(middleCartId);
    expect(secondPage.records[0]?.lines.map((line) => line.id)).toEqual([middleLine.id]);
  });

  it('uses the Cart ID as a cursor tie-breaker for equal creation timestamps', async () => {
    const repository = new CartRepository();
    const tieBranchId = newId();
    await testdb.db.insert(branches).values({
      id: tieBranchId,
      organizationId: orgA,
      code: `TIE-${tieBranchId.slice(0, 8)}`,
      name: 'Cart equal-timestamp branch',
    });
    const createdAt = new Date('2026-01-04T00:00:00.000Z');
    const firstId = await createRawCart(tieBranchId, createdAt);
    const secondId = await createRawCart(tieBranchId, createdAt);
    const [expectedFirstId, expectedSecondId] = [firstId, secondId].sort();

    const firstPage = await repository.listCarts(testdb.db, orgA, tieBranchId, 1);
    expect(firstPage.records.map((record) => record.cart.id)).toEqual([expectedFirstId]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await repository.listCarts(
      testdb.db,
      orgA,
      tieBranchId,
      1,
      firstPage.nextCursor ?? undefined,
    );
    expect(secondPage.records.map((record) => record.cart.id)).toEqual([expectedSecondId]);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.hasMore).toBe(false);
  });

  it('does not expose non-POS carts through the Cart application surface', async () => {
    const onlineCartId = await createRawCart(
      branchA,
      new Date('2026-02-01T00:00:00.000Z'),
      'ONLINE',
    );
    const salesCartId = await createRawCart(branchA, new Date('2026-02-02T00:00:00.000Z'), 'SALES');

    expect(await service.get(orgA, onlineCartId)).toBeNull();
    expect(await service.get(orgA, salesCartId)).toBeNull();
    const page = await service.list(orgA, branchA, 100);
    expect(page.items.some((cart) => cart.id === onlineCartId)).toBe(false);
    expect(page.items.some((cart) => cart.id === salesCartId)).toBe(false);
    expect(page.items.every((cart) => cart.channel === 'POS' && cart.status === 'DRAFT')).toBe(
      true,
    );
  });

  it('saves item and empty Draft snapshots without changing Cart state or emitting events', async () => {
    const repository = new CartRepository();
    const catalog = { validateSellableVariant: vi.fn() } as unknown as CatalogContracts;
    const customers = { getCustomer: vi.fn() } as unknown as CustomersContracts;
    const saveService = new CartService(
      testdb.db,
      repository,
      catalog,
      customers,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const cartId = await createRawCart();
    const item = await repository.createLine(testdb.db, {
      id: newId(),
      organizationId: orgA,
      cartId,
      variantId: variantA,
      unitId: unitA,
      quantity: '1.25',
    });
    const [cartBefore] = await testdb.db.select().from(carts).where(eq(carts.id, cartId));
    const itemsBefore = await testdb.db
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.organizationId, orgA), eq(cartItems.cartId, cartId)));
    const outboxBefore = await testdb.db
      .select({ id: integrationOutbox.id })
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, cartId));
    const payload = { cartId, expectedVersion: 1 };
    const mutation = context(`save-no-op-${newId()}`, payload);

    const saved = await saveService.save(
      { organizationId: orgA, cartId, expectedVersion: 1 },
      mutation,
    );
    const replay = await saveService.save(
      { organizationId: orgA, cartId, expectedVersion: 1 },
      mutation,
    );

    expect(saved).toMatchObject({
      id: cartId,
      status: 'DRAFT',
      version: 1,
      items: [{ id: item.id, quantity: '1.25000000' }],
    });
    expect(replay).toEqual(saved);
    expect(await testdb.db.select().from(carts).where(eq(carts.id, cartId))).toEqual([cartBefore]);
    expect(
      await testdb.db
        .select()
        .from(cartItems)
        .where(and(eq(cartItems.organizationId, orgA), eq(cartItems.cartId, cartId))),
    ).toEqual(itemsBefore);
    expect(
      await testdb.db
        .select({ id: integrationOutbox.id })
        .from(integrationOutbox)
        .where(eq(integrationOutbox.aggregateId, cartId)),
    ).toEqual(outboxBefore);
    expect(catalog.validateSellableVariant).not.toHaveBeenCalled();
    expect(customers.getCustomer).not.toHaveBeenCalled();

    const [outcome] = await testdb.db
      .select()
      .from(idempotencyOutcomes)
      .where(
        and(
          eq(
            idempotencyOutcomes.scope,
            `ORGANIZATION_USER:${actorId}:${orgA}:POST:/api/v1/pos/carts/:cartId/save`,
          ),
          eq(idempotencyOutcomes.idempotencyKey, mutation.idempotencyKey),
        ),
      );
    expect(outcome).toMatchObject({
      requestHash: mutation.requestHash,
      status: 'COMPLETED',
      responseJson: saved,
    });

    const emptyCartId = await createRawCart();
    await expect(
      saveService.save(
        { organizationId: orgA, cartId: emptyCartId, expectedVersion: 1 },
        context(`save-empty-${newId()}`, { cartId: emptyCartId, expectedVersion: 1 }),
      ),
    ).resolves.toMatchObject({ id: emptyCartId, version: 1, items: [] });
  });

  it('creates one Cart hold through Inventory and blocks edits until resume releases it', async () => {
    const createReservation = vi.spyOn(inventory, 'createCartReservation');
    const releaseReservation = vi.spyOn(inventory, 'releaseCartReservation');
    const cart = await service.create(
      { organizationId: orgA, branchId: branchA, customerId: null },
      context(`hold-create-${newId()}`, { branchId: branchA }),
    );
    const added = await service.addItem(
      {
        organizationId: orgA,
        cartId: cart.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '2',
        expectedVersion: 1,
      },
      context(`hold-add-${newId()}`, {
        cartId: cart.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '2',
        expectedVersion: 1,
      }),
    );

    const held = await service.hold(
      { organizationId: orgA, cartId: cart.id, warehouseId: warehouseA, expectedVersion: 2 },
      context(`hold-active-${newId()}`, {
        cartId: cart.id,
        warehouseId: warehouseA,
        expectedVersion: 2,
      }),
    );

    expect(held.version).toBe(2);
    expect(held.hold).toMatchObject({ status: 'ACTIVE', warehouseId: warehouseA });
    expect(createReservation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: orgA,
        branchId: branchA,
        warehouseId: warehouseA,
        cartVersion: 2,
        demands: [{ variantId: variantA, quantity: '2.00000000' }],
      }),
    );

    await expect(
      service.updateItem(
        {
          organizationId: orgA,
          cartId: cart.id,
          itemId: added.items[0]!.id,
          quantity: '3',
          expectedVersion: 2,
        },
        context(`held-edit-${newId()}`, {
          cartId: cart.id,
          itemId: added.items[0]!.id,
          quantity: '3',
          expectedVersion: 2,
        }),
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_NOT_ALLOWED' });

    const resumed = await service.resume(
      { organizationId: orgA, cartId: cart.id, expectedVersion: 2 },
      context(`hold-resume-${newId()}`, { cartId: cart.id, expectedVersion: 2 }),
    );

    expect(resumed.version).toBe(2);
    expect(resumed.hold).toMatchObject({ status: 'RELEASED', shortages: [] });
    expect(releaseReservation).toHaveBeenCalledOnce();
    expect(await service.get(orgA, cart.id)).toMatchObject({ id: cart.id, hold: null });
  });

  it('keeps a Cart editable and records explicit shortages when Inventory cannot hold all items', async () => {
    vi.spyOn(inventory, 'createCartReservation').mockResolvedValueOnce({
      kind: 'SHORTAGES',
      reservation: null,
      organizationId: orgA,
      branchId: branchA,
      warehouseId: warehouseA,
      referenceId: 'unused-by-cart-response',
      cartVersion: 2,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      shortages: [
        {
          variantId: variantA,
          stockPositionId: null,
          requested: '5.00000000',
          available: '0.00000000',
          shortage: '5.00000000',
        },
      ],
    });
    const cart = await service.create(
      { organizationId: orgA, branchId: branchA, customerId: null },
      context(`short-create-${newId()}`, { branchId: branchA }),
    );
    await service.addItem(
      {
        organizationId: orgA,
        cartId: cart.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '5',
        expectedVersion: 1,
      },
      context(`short-add-${newId()}`, {
        cartId: cart.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '5',
        expectedVersion: 1,
      }),
    );

    const result = await service.hold(
      { organizationId: orgA, cartId: cart.id, warehouseId: warehouseA, expectedVersion: 2 },
      context(`short-hold-${newId()}`, {
        cartId: cart.id,
        warehouseId: warehouseA,
        expectedVersion: 2,
      }),
    );

    expect(result.hold).toMatchObject({
      status: 'FAILED',
      shortages: [{ variantId: variantA, requested: '5.00000000', shortage: '5.00000000' }],
    });
    const [hold] = await testdb.db
      .select()
      .from(cartHolds)
      .where(and(eq(cartHolds.organizationId, orgA), eq(cartHolds.cartId, cart.id)));
    expect(hold?.status).toBe('FAILED');
    await expect(
      service.addItem(
        {
          organizationId: orgA,
          cartId: cart.id,
          variantId: variantA,
          unitId: unitA,
          quantity: '1',
          expectedVersion: 2,
        },
        context(`short-edit-${newId()}`, {
          cartId: cart.id,
          variantId: variantA,
          unitId: unitA,
          quantity: '1',
          expectedVersion: 2,
        }),
      ),
    ).resolves.toMatchObject({ version: 3 });
  });

  it('converges a retried in-progress hold checkpoint instead of poisoning the Cart', async () => {
    const createReservation = vi.spyOn(inventory, 'createCartReservation');
    createReservation.mockClear();
    const cartId = await createRawCart();
    await insertRawLine(cartId, '1');
    const key = `pending-hold-${newId()}`;
    const payload = { cartId, warehouseId: warehouseA, expectedVersion: 1 };
    const holdId = newId();
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    await testdb.db.insert(idempotencyOutcomes).values({
      id: newId(),
      scope: `ORGANIZATION_USER:${actorId}:${orgA}:POST:/api/v1/pos/carts/:cartId/hold`,
      idempotencyKey: key,
      requestHash: requestHash(payload),
      status: 'IN_PROGRESS',
    });
    await testdb.db.insert(cartHolds).values({
      id: holdId,
      organizationId: orgA,
      cartId,
      branchId: branchA,
      warehouseId: warehouseA,
      cartVersion: 1,
      ttlMinutes: 15,
      policyVersion: 0,
      expiresAt,
      actorId,
      correlationId: `correlation-${key}`,
      causationId: key,
    });

    const completed = await service.hold(
      { organizationId: orgA, cartId, warehouseId: warehouseA, expectedVersion: 1 },
      context(key, payload),
    );

    expect(completed.hold).toMatchObject({ id: holdId, status: 'ACTIVE' });
    expect(createReservation).toHaveBeenCalledOnce();
    expect(createReservation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        referenceId: holdId,
        idempotencyKey: `cart-hold:${holdId}`,
        requestHash: requestHash({
          holdId,
          cartId,
          cartVersion: 1,
          warehouseId: warehouseA,
          demands: [{ variantId: variantA, quantity: '1.00000000' }],
          expiresAt: expiresAt.toISOString(),
        }),
      }),
    );
    const replay = await service.hold(
      { organizationId: orgA, cartId, warehouseId: warehouseA, expectedVersion: 1 },
      context(key, payload),
    );
    expect(replay).toEqual(completed);
  });

  it('resumes a stale pending hold without an Inventory reservation and unblocks edits', async () => {
    vi.spyOn(inventory, 'releaseCartReservation').mockRejectedValueOnce({
      code: 'RESOURCE_NOT_FOUND',
    });
    const cartId = await createRawCart();
    const item = await insertRawLine(cartId, '1');
    await testdb.db.insert(cartHolds).values({
      id: newId(),
      organizationId: orgA,
      cartId,
      branchId: branchA,
      warehouseId: warehouseA,
      cartVersion: 1,
      ttlMinutes: 15,
      policyVersion: 0,
      expiresAt: new Date(Date.now() + 15 * 60_000),
      actorId,
      correlationId: 'stale-pending-hold',
      causationId: 'lost-hold-request',
    });

    const resumed = await service.resume(
      { organizationId: orgA, cartId, expectedVersion: 1 },
      context(`resume-pending-${newId()}`, { cartId, expectedVersion: 1 }),
    );

    expect(resumed.hold).toMatchObject({ status: 'RELEASED', shortages: [] });
    expect(await service.get(orgA, cartId)).toMatchObject({ hold: null });
    await expect(
      service.updateItem(
        {
          organizationId: orgA,
          cartId,
          itemId: item.rows[0].id,
          quantity: '2',
          expectedVersion: 1,
        },
        context(`edit-after-pending-${newId()}`, {
          cartId,
          itemId: item.rows[0].id,
          quantity: '2',
          expectedVersion: 1,
        }),
      ),
    ).resolves.toMatchObject({ version: 2 });
  });

  it('rejects empty Cart hold and branch-mismatched warehouses before Inventory reservation', async () => {
    const createReservation = vi.spyOn(inventory, 'createCartReservation');
    createReservation.mockClear();
    const cart = await service.create(
      { organizationId: orgA, branchId: branchA, customerId: null },
      context(`empty-hold-create-${newId()}`, { branchId: branchA }),
    );
    await expect(
      service.hold(
        { organizationId: orgA, cartId: cart.id, warehouseId: warehouseA, expectedVersion: 1 },
        context(`empty-hold-${newId()}`, {
          cartId: cart.id,
          warehouseId: warehouseA,
          expectedVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await service.addItem(
      {
        organizationId: orgA,
        cartId: cart.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '1',
        expectedVersion: 1,
      },
      context(`empty-hold-add-${newId()}`, {
        cartId: cart.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '1',
        expectedVersion: 1,
      }),
    );
    await expect(
      service.hold(
        { organizationId: orgA, cartId: cart.id, warehouseId: newId(), expectedVersion: 2 },
        context(`bad-warehouse-hold-${newId()}`, {
          cartId: cart.id,
          warehouseId: 'not-the-real-warehouse',
          expectedVersion: 2,
        }),
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(createReservation).not.toHaveBeenCalled();
  });

  it('quotes every Cart line with live per-line prices and a grand total without persisting', async () => {
    const quote = vi.spyOn(pricing, 'getPriceQuote').mockResolvedValue({
      amount: '12.50000000',
      priceType: 'CASH',
      channel: 'POS',
      source: 'BRANCH',
    });
    const cartId = await createRawCart();
    await insertRawLine(cartId, '2');
    const result = await service.quote(orgA, cartId, 'CASH');
    expect(quote).toHaveBeenCalledWith(
      orgA,
      expect.objectContaining({
        variantId: variantA,
        unitId: unitA,
        priceType: 'CASH',
        channel: 'POS',
        branchId: branchA,
      }),
    );
    expect(result).toMatchObject({
      cartId,
      cartVersion: 1,
      branchId: branchA,
      priceType: 'CASH',
      total: '25.00000000',
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      itemId: expect.any(String),
      variantId: variantA,
      unitId: unitA,
      quantity: '2.00000000',
      unitPrice: '12.50000000',
      lineTotal: '25.00000000',
      source: 'BRANCH',
    });
  });

  it('reports per-line availability and shortage against a warehouse without reserving', async () => {
    const availability = vi.spyOn(inventory, 'getAvailability');
    availability
      .mockResolvedValueOnce({
        stockPositionId: newId(),
        organizationId: orgA,
        warehouseId: warehouseA,
        variantId: variantA,
        onHand: '10.00000000',
        reserved: '0.00000000',
        allocated: '0.00000000',
        available: '10.00000000',
      })
      .mockResolvedValueOnce(null);
    const cartId = await createRawCart();
    await insertRawLine(cartId, '3');
    const result = await service.checkAvailability(orgA, cartId, warehouseA);
    expect(result.cartVersion).toBe(1);
    expect(result.warehouseId).toBe(warehouseA);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      variantId: variantA,
      quantity: '3.00000000',
      available: '10.00000000',
      shortage: '0.00000000',
    });
    expect(availability).toHaveBeenCalledWith(orgA, warehouseA, variantA);
  });

  it('rejects availability checks for a warehouse outside the Cart branch', async () => {
    const cartId = await createRawCart();
    await insertRawLine(cartId, '1');
    await expect(service.checkAvailability(orgA, cartId, newId())).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('holds the tenant-scoped POS Draft root lock until the save outcome commits', async () => {
    const repository = new CartRepository();
    const originalFindForUpdate = repository.findCartForUpdate.bind(repository);
    let notifyLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => {
      notifyLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    vi.spyOn(repository, 'findCartForUpdate').mockImplementation(
      async (executor, organizationId, cartId) => {
        const record = await originalFindForUpdate(executor, organizationId, cartId);
        notifyLocked();
        await release;
        return record;
      },
    );
    const saveService = new CartService(
      testdb.db,
      repository,
      {} as CatalogContracts,
      {} as CustomersContracts,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const cartId = await createRawCart();
    const savePromise = saveService.save(
      { organizationId: orgA, cartId, expectedVersion: 1 },
      context(`save-lock-${newId()}`, { cartId, expectedVersion: 1 }),
    );
    await locked;

    const competingClient = await testdb.client.connect();
    try {
      await competingClient.query("SET lock_timeout = '100ms'");
      await expect(
        competingClient.query(
          `UPDATE cart.carts
              SET version = version + 1
            WHERE id = $1
              AND organization_id = $2`,
          [cartId, orgA],
        ),
      ).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await competingClient.query('RESET lock_timeout');
      competingClient.release();
      releaseLock();
    }

    await expect(savePromise).resolves.toMatchObject({ id: cartId, version: 1 });
  });

  it('serializes a normalized no-op item update on the Cart root', async () => {
    const repository = new CartRepository();
    const originalFindForUpdate = repository.findCartForUpdate.bind(repository);
    let notifyLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => {
      notifyLocked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    vi.spyOn(repository, 'findCartForUpdate').mockImplementation(
      async (executor, organizationId, cartId) => {
        const record = await originalFindForUpdate(executor, organizationId, cartId);
        notifyLocked();
        await release;
        return record;
      },
    );
    const updateService = new CartService(
      testdb.db,
      repository,
      {} as CatalogContracts,
      {} as CustomersContracts,
      undefined as never,
      undefined as never,
      undefined as never,
    );
    const cartId = await createRawCart();
    const item = await repository.createLine(testdb.db, {
      id: newId(),
      organizationId: orgA,
      cartId,
      variantId: variantA,
      unitId: unitA,
      quantity: '1',
    });
    const updatePromise = updateService.updateItem(
      {
        organizationId: orgA,
        cartId,
        itemId: item.id,
        quantity: '1.00000000',
        expectedVersion: 1,
      },
      context(`no-op-update-lock-${newId()}`, {
        cartId,
        itemId: item.id,
        quantity: '1.00000000',
        expectedVersion: 1,
      }),
    );
    await locked;

    const competingClient = await testdb.client.connect();
    try {
      await competingClient.query("SET lock_timeout = '100ms'");
      await expect(
        competingClient.query(
          `UPDATE cart.carts
              SET version = version + 1
            WHERE id = $1
              AND organization_id = $2`,
          [cartId, orgA],
        ),
      ).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await competingClient.query('RESET lock_timeout');
      competingClient.release();
      releaseLock();
    }

    await expect(updatePromise).resolves.toMatchObject({
      id: cartId,
      version: 1,
      items: [{ id: item.id, quantity: '1.00000000' }],
    });
  });

  it('rejects a durable IN_PROGRESS save without changing Cart state', async () => {
    const cartId = await createRawCart();
    const key = `save-in-progress-${newId()}`;
    const payload = { cartId, expectedVersion: 1 };
    const mutation = context(key, payload);
    const scope = `ORGANIZATION_USER:${actorId}:${orgA}:POST:/api/v1/pos/carts/:cartId/save`;
    await testdb.db.insert(idempotencyOutcomes).values({
      id: newId(),
      scope,
      idempotencyKey: key,
      requestHash: mutation.requestHash,
      status: 'IN_PROGRESS',
    });
    const [before] = await testdb.db.select().from(carts).where(eq(carts.id, cartId));

    await expect(
      service.save({ organizationId: orgA, cartId, expectedVersion: 1 }, mutation),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Cart mutation is already in progress.',
    });

    expect(await testdb.db.select().from(carts).where(eq(carts.id, cartId))).toEqual([before]);
    const [outcome] = await testdb.db
      .select({
        status: idempotencyOutcomes.status,
        responseJson: idempotencyOutcomes.responseJson,
      })
      .from(idempotencyOutcomes)
      .where(
        and(eq(idempotencyOutcomes.scope, scope), eq(idempotencyOutcomes.idempotencyKey, key)),
      );
    expect(outcome).toEqual({ status: 'IN_PROGRESS', responseJson: null });
  });

  it('rejects malformed and scope-mismatched Cart cursors with stable validation errors', async () => {
    const repository = new CartRepository();
    await expect(
      repository.listCarts(testdb.db, orgA, branchA, 10, 'not-a-cursor'),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'after' },
    });

    const otherBranch = newId();
    await testdb.db.insert(branches).values({
      id: otherBranch,
      organizationId: orgA,
      code: `CURSOR-${otherBranch.slice(0, 8)}`,
      name: 'Cursor other branch',
    });
    const page = await repository.listCarts(testdb.db, orgA, branchA, 1);
    await expect(
      repository.listCarts(testdb.db, orgA, otherBranch, 1, page.nextCursor ?? undefined),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'after' } });
  });

  it('writes versioned tenant event envelopes with minimized Cart payloads', async () => {
    const cart = await service.create(
      { organizationId: orgA, branchId: branchA, customerId: null },
      context('event-cart', { branchId: branchA }),
    );
    const added = await service.addItem(
      {
        organizationId: orgA,
        cartId: cart.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '1.25',
        expectedVersion: 1,
      },
      context('event-line', {
        cartId: cart.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '1.25',
        expectedVersion: 1,
      }),
    );
    const events = await testdb.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, cart.id));

    expect(events).toHaveLength(2);
    const createdEvent = events.find((event) => event.eventType === 'cart.cart-created');
    const lineAddedEvent = events.find((event) => event.eventType === 'cart.cart-line-added');
    expect(createdEvent?.payload).toMatchObject({
      eventType: 'cart.cart-created',
      eventVersion: 1,
      eventScope: 'TENANT',
      organizationId: orgA,
      aggregateType: 'Cart',
      aggregateId: cart.id,
      aggregateVersion: 1,
      payload: { cartId: cart.id, branchId: branchA, channel: 'POS', customerId: null },
    });
    expect(lineAddedEvent?.payload).toMatchObject({
      eventType: 'cart.cart-line-added',
      eventVersion: 1,
      eventScope: 'TENANT',
      organizationId: orgA,
      aggregateId: cart.id,
      aggregateVersion: 2,
      payload: {
        cartId: cart.id,
        lineId: added.items[0]?.id,
        variantId: variantA,
        unitId: unitA,
        quantity: '1.25000000',
      },
    });
  });

  it('does not hold the Cart transaction while Catalog or Customers contracts query a small pool', async () => {
    const smallDb = await createTestDatabase({ max: 1 });
    try {
      const organizationId = newId();
      const branchId = newId();
      const unitId = newId();
      const productId = newId();
      const variantId = newId();
      const customerId = newId();
      await smallDb.db
        .insert(organizations)
        .values({ id: organizationId, name: 'Small Pool Cart' });
      await smallDb.db.insert(branches).values({
        id: branchId,
        organizationId,
        code: 'SMALL-POOL',
        name: 'Small Pool Branch',
      });
      await smallDb.db.insert(unitDefinitions).values({
        id: unitId,
        organizationId,
        name: 'Small Pool Piece',
        symbol: 'pc',
      });
      await smallDb.db.insert(products).values({
        id: productId,
        organizationId,
        name: 'Small Pool Product',
        status: 'ACTIVE',
      });
      await smallDb.db.insert(productVariants).values({
        id: variantId,
        organizationId,
        productId,
        name: 'Small Pool Variant',
        sku: 'SMALL-POOL-SKU',
        baseUnitId: unitId,
        status: 'ACTIVE',
      });

      const catalog: CatalogContracts = {
        getProduct: async () => null,
        getVariant: async () => null,
        resolveBarcode: async () => null,
        convertUnit: async () => '1',
        validateSellableVariant: async (requestedOrganizationId, requestedVariantId) => {
          await smallDb.db
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, requestedOrganizationId));
          return {
            variant: {
              id: requestedVariantId,
              organizationId: requestedOrganizationId,
              productId,
              name: 'Small Pool Variant',
              sku: 'SMALL-POOL-SKU',
              barcode: null,
              baseUnitId: unitId,
              categoryId: null,
              status: 'ACTIVE',
              version: 1,
            },
            productStatus: 'ACTIVE',
          };
        },
      };
      const customers: CustomersContracts = {
        getCustomer: async (requestedOrganizationId, requestedCustomerId) => {
          await smallDb.db
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, requestedOrganizationId));
          return {
            id: requestedCustomerId,
            organizationId: requestedOrganizationId,
            type: 'INDIVIDUAL',
            displayName: 'Small Pool Customer',
            code: null,
          };
        },
        searchCustomers: async () => [],
      };
      const smallPoolService = new CartService(
        smallDb.db,
        new CartRepository(),
        catalog,
        customers,
        undefined as never,
        undefined as never,
        undefined as never,
      );
      const smallContext = (key: string, payload: unknown) => ({
        organizationId,
        actorId: 'small-pool-actor',
        correlationId: key,
        idempotencyKey: key,
        requestHash: requestHash(payload),
      });
      const cart = await smallPoolService.create(
        { organizationId, branchId, customerId },
        smallContext('small-pool-create', { branchId, customerId }),
      );
      const added = await smallPoolService.addItem(
        {
          organizationId,
          cartId: cart.id,
          variantId,
          unitId,
          quantity: '1',
          expectedVersion: 1,
        },
        smallContext('small-pool-add', {
          cartId: cart.id,
          variantId,
          unitId,
          quantity: '1',
          expectedVersion: 1,
        }),
      );

      expect(added.version).toBe(2);
      expect(added.items[0]?.quantity).toBe('1.00000000');
    } finally {
      await smallDb.teardown();
    }
  });
});

function sellableVariant(organizationId: string, variantId: string): SellableVariantView {
  return {
    variant: {
      id: variantId,
      organizationId,
      productId: newId(),
      name: 'Variant',
      sku: 'SKU',
      barcode: null,
      baseUnitId: newId(),
      categoryId: null,
      status: 'ACTIVE',
      version: 1,
    },
    productStatus: 'ACTIVE',
  };
}
