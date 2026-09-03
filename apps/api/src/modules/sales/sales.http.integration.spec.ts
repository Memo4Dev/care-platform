import { createHmac } from 'node:crypto';

import {
  branchAccess,
  businessCustomers,
  cartItems,
  carts,
  fifoLayers,
  newId,
  planEntitlements,
  platformTenants,
  priceBooks,
  priceEntries,
  productVariants,
  products,
  reservationItems,
  reservations,
  stockPositions,
  subscriptions,
  unitDefinitions,
  users,
  warehouses,
  plans,
} from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../main';
import { setupSwagger } from '../../swagger';
import { DATABASE } from '../database/database.tokens';
import { IdentityProvisioningService } from '../identity/application/identity-provisioning.service';
import { RoleRepository } from '../identity/infrastructure/role.repository';
import { UserRepository } from '../identity/infrastructure/user.repository';
import { OrganizationService } from '../organization/application/organization.service';
import { OrganizationRepository } from '../organization/infrastructure/organization.repository';

describe('Sales HTTP boundary', () => {
  let testdb: TestDatabase;
  let app: NestFastifyApplication;
  let ownerBearer: string;
  let deniedBearer: string;
  let foreignBearer: string;
  let organizationA: string;
  let branchA: string;
  let unauthorizedBranchA: string;
  let warehouseA: string;
  let unitA: string;
  let variantA: string;
  let customerA: string;
  let stockPositionIdA: string;

  beforeAll(async () => {
    testdb = await createTestDatabase();
    process.env.DATABASE_URL = testdb.uri;
    process.env.SUPABASE_JWT_SECRET = 'sales-http-test-secret';
    process.env.SUPABASE_JWT_ISSUER = 'https://auth.example.test';
    process.env.SUPABASE_PLATFORM_AUDIENCE = 'platform-api';
    process.env.SUPABASE_TENANT_AUDIENCE = 'tenant-api';
    process.env.SALES_INTERNAL_BEARER_TOKEN = 'sales-internal-secret';

    const organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    const identityProvisioning = new IdentityProvisioningService(
      testdb.db,
      new UserRepository(),
      new RoleRepository(),
    );

    const tenantA = await organizations.createOrganization({ name: 'Sales HTTP Org A' });
    organizationA = tenantA.organization.id;
    branchA = newId();
    unauthorizedBranchA = newId();
    await organizations.createBranch({
      organizationId: organizationA,
      branchId: branchA,
      code: 'SLS-A',
      name: 'Sales HTTP Branch A',
    });
    await organizations.createBranch({
      organizationId: organizationA,
      branchId: unauthorizedBranchA,
      code: 'SLS-A-UNAUTH',
      name: 'Sales HTTP Unauthorized Branch',
    });
    const owner = await identityProvisioning.provisionInitialOwner({
      organizationId: organizationA,
      email: 'sales-http-owner@example.test',
      name: 'Sales HTTP Owner',
      supabaseUserId: 'sales-http-owner',
      correlationId: newId(),
      causationId: newId(),
    });
    await testdb.db.insert(branchAccess).values([
      { organizationId: organizationA, branchId: branchA, userId: owner.user.id },
      { organizationId: organizationA, branchId: unauthorizedBranchA, userId: owner.user.id },
    ]);
    await testdb.db.insert(users).values({
      id: newId(),
      organizationId: organizationA,
      supabaseUserId: 'sales-http-denied',
      email: 'sales-http-denied@example.test',
      name: 'Sales HTTP Denied',
    });
    const deniedUser = await testdb.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.supabaseUserId, 'sales-http-denied'))
      .limit(1);
    await testdb.db.insert(branchAccess).values({
      organizationId: organizationA,
      branchId: branchA,
      userId: deniedUser[0]!.id,
    });
    await activateTenant(testdb.db, organizationA, 'SALES_HTTP_A');

    const tenantB = await organizations.createOrganization({ name: 'Sales HTTP Org B' });
    const branchB = newId();
    await organizations.createBranch({
      organizationId: tenantB.organization.id,
      branchId: branchB,
      code: 'SLS-B',
      name: 'Sales HTTP Branch B',
    });
    const foreignOwner = await identityProvisioning.provisionInitialOwner({
      organizationId: tenantB.organization.id,
      email: 'sales-http-foreign@example.test',
      name: 'Sales HTTP Foreign Owner',
      supabaseUserId: 'sales-http-foreign',
      correlationId: newId(),
      causationId: newId(),
    });
    await testdb.db.insert(branchAccess).values({
      organizationId: tenantB.organization.id,
      branchId: branchB,
      userId: foreignOwner.user.id,
    });
    await activateTenant(testdb.db, tenantB.organization.id, 'SALES_HTTP_B');

    unitA = newId();
    const productA = newId();
    variantA = newId();
    customerA = newId();
    warehouseA = newId();
    stockPositionIdA = newId();
    await testdb.db.insert(unitDefinitions).values({
      id: unitA,
      organizationId: organizationA,
      name: 'Sales Piece',
      symbol: 'pc',
    });
    await testdb.db.insert(products).values({
      id: productA,
      organizationId: organizationA,
      name: 'Sales Product',
      status: 'ACTIVE',
    });
    await testdb.db.insert(productVariants).values({
      id: variantA,
      organizationId: organizationA,
      productId: productA,
      name: 'Sales Variant',
      sku: 'SLS-SKU',
      baseUnitId: unitA,
      status: 'ACTIVE',
    });
    await testdb.db.insert(businessCustomers).values({
      id: customerA,
      organizationId: organizationA,
      type: 'BUSINESS',
      displayName: 'Sales Customer',
      code: 'SLS-CUST',
    });
    await testdb.db.insert(warehouses).values({
      id: warehouseA,
      organizationId: organizationA,
      branchId: branchA,
      code: 'MAIN',
      name: 'Sales Main Warehouse',
    });
    await testdb.db.insert(stockPositions).values({
      id: stockPositionIdA,
      organizationId: organizationA,
      warehouseId: warehouseA,
      variantId: variantA,
      onHand: '10.00000000',
      reserved: '0.00000000',
      allocated: '0.00000000',
    });
    await testdb.db.insert(fifoLayers).values({
      id: newId(),
      organizationId: organizationA,
      stockPositionId: stockPositionIdA,
      quantity: '10.00000000',
      remainingQuantity: '10.00000000',
      unitCost: '1.0000',
    });
    const priceBookId = newId();
    await testdb.db.insert(priceBooks).values({
      id: priceBookId,
      organizationId: organizationA,
      name: 'Sales Price Book',
      isDefault: true,
      isActive: true,
    });
    await testdb.db.insert(priceEntries).values({
      id: newId(),
      organizationId: organizationA,
      priceBookId,
      variantId: variantA,
      unitId: unitA,
      priceType: 'CASH',
      channel: 'POS',
      branchId: branchA,
      amount: '12.50',
      effectiveFrom: new Date('2020-01-01'),
    });

    ownerBearer = jwt('sales-http-owner');
    deniedBearer = jwt('sales-http-denied');
    foreignBearer = jwt('sales-http-foreign');
    app = await createApp();
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await app?.get(DATABASE).$client.end();
    await testdb?.teardown();
  });

  it('requires authentication and validates warehouse for draft checkout', async () => {
    const cartId = await createDraftCart({ customerId: customerA });

    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/sales',
      payload: { cartId, warehouseId: warehouseA },
      headers: { 'idempotency-key': newId(), 'if-match': '1' },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const missingWarehouse = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/sales',
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { cartId },
    });
    expect(missingWarehouse.statusCode).toBe(422);
    expect(missingWarehouse.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', correlationId: expect.any(String) },
    });
  });

  it('denies a tenant user without sales.create', async () => {
    const cartId = await createDraftCart();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/sales',
      headers: {
        authorization: `Bearer ${deniedBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { cartId, warehouseId: warehouseA },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
  });

  it('creates a PENDING_PAYMENT sale from a draft cart and replays idempotently', async () => {
    const cartId = await createDraftCart({ customerId: customerA, quantity: '2.00000000' });
    const idemKey = newId();

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/sales',
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': idemKey,
        'if-match': '1',
      },
      payload: { cartId, warehouseId: warehouseA, priceType: 'CASH' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      data: {
        cartId,
        status: 'PENDING_PAYMENT',
        warehouseId: warehouseA,
        customerId: customerA,
        priceType: 'CASH',
        subtotal: '25.00000000',
        total: '25.00000000',
        items: [
          expect.objectContaining({
            variantId: variantA,
            quantity: '2.00000000',
            unitPrice: '12.50000000',
            lineTotal: '25.00000000',
          }),
        ],
      },
    });
    const saleId = created.json().data.id as string;

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/sales',
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': idemKey,
        'if-match': '1',
      },
      payload: { cartId, warehouseId: warehouseA, priceType: 'CASH' },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());

    const [storedCart] = await testdb.db
      .select({ status: carts.status, version: carts.version })
      .from(carts)
      .where(and(eq(carts.id, cartId), eq(carts.organizationId, organizationA)));
    expect(storedCart).toMatchObject({ status: 'CHECKED_OUT', version: 2 });

    const [reservation] = await testdb.db
      .select({
        status: reservations.status,
        referenceType: reservations.referenceType,
        referenceId: reservations.referenceId,
      })
      .from(reservations)
      .where(eq(reservations.referenceId, saleId));
    expect(reservation).toMatchObject({
      status: 'ACTIVE',
      referenceType: 'PENDING_SALE',
      referenceId: saleId,
    });
  });

  it('returns 404 for foreign-tenant sale reads and 409 for stale cart version', async () => {
    const cartId = await createDraftCart();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/sales',
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { cartId, warehouseId: warehouseA },
    });
    const saleId = created.json().data.id as string;

    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/sales/${saleId}`,
      headers: { authorization: `Bearer ${foreignBearer}` },
    });
    expect(foreign.statusCode).toBe(404);

    const stale = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/sales',
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
      payload: { cartId: await createDraftCart(), warehouseId: warehouseA },
    });
    expect(stale.statusCode).toBe(409);
  });

  it('cancels a pending sale and releases its reservation exactly once', async () => {
    const cartId = await createDraftCart({ quantity: '1.00000000' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/sales',
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { cartId, warehouseId: warehouseA },
    });
    const saleId = created.json().data.id as string;
    const reservationId = created.json().data.inventoryReservationId as string;

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/sales/${saleId}/cancel`,
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { reason: 'customer left' },
    });
    expect(cancelled.statusCode).toBe(201);
    expect(cancelled.json()).toMatchObject({
      data: { id: saleId, status: 'CANCELLED', cancellationReason: 'customer left' },
    });

    const repeated = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/sales/${saleId}/cancel`,
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { reason: 'customer left' },
    });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json()).toMatchObject({ data: { id: saleId, status: 'CANCELLED' } });

    const [reservation] = await testdb.db
      .select({ status: reservations.status })
      .from(reservations)
      .where(eq(reservations.id, reservationId));
    expect(reservation?.status).toBe('RELEASED');
  });

  it('completes a pending sale through the internal trusted boundary and consumes stock exactly once', async () => {
    const cartId = await createHeldCart();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/sales',
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { cartId },
    });
    expect(created.statusCode).toBe(201);
    const saleId = created.json().data.id as string;
    const reservationId = created.json().data.inventoryReservationId as string;

    const cartRead = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts/${cartId}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(cartRead.statusCode).toBe(200);
    expect(cartRead.json()).toMatchObject({
      data: { id: cartId, status: 'CHECKED_OUT', hold: null },
    });

    const [beforeStock] = await testdb.db
      .select({ onHand: stockPositions.onHand, reserved: stockPositions.reserved })
      .from(stockPositions)
      .where(eq(stockPositions.id, stockPositionIdA));

    const completed = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/sales/${saleId}/complete`,
      headers: {
        authorization: `Bearer ${internalJwt('sales-internal-secret', organizationA)}`,
        'idempotency-key': newId(),
      },
      payload: { completionReferenceType: 'PAYMENT', completionReferenceId: 'pay-1' },
    });
    expect(completed.statusCode).toBe(201);
    expect(completed.json()).toMatchObject({ data: { id: saleId, status: 'COMPLETED' } });

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/internal/sales/${saleId}/complete`,
      headers: {
        authorization: `Bearer ${internalJwt('sales-internal-secret', organizationA)}`,
        'idempotency-key': newId(),
      },
      payload: { completionReferenceType: 'PAYMENT', completionReferenceId: 'pay-1' },
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toMatchObject({ data: { id: saleId, status: 'COMPLETED' } });

    const [reservation] = await testdb.db
      .select({ status: reservations.status })
      .from(reservations)
      .where(eq(reservations.id, reservationId));
    expect(reservation?.status).toBe('CONSUMED');

    const [stock] = await testdb.db
      .select({ onHand: stockPositions.onHand, reserved: stockPositions.reserved })
      .from(stockPositions)
      .where(eq(stockPositions.id, stockPositionIdA));
    expect(decimalDelta(beforeStock!.onHand, stock!.onHand)).toBe('1.00000000');
    expect(decimalDelta(beforeStock!.reserved, stock!.reserved)).toBe('1.00000000');
  });

  it('documents the Sales routes with tenant-bearer and internal-bearer authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs-json' });
    expect(response.statusCode).toBe(200);
    const document = response.json() as {
      paths: Record<
        string,
        Record<
          string,
          {
            tags?: string[];
            security?: Array<Record<string, unknown>>;
            parameters?: Array<{ name?: string; required?: boolean }>;
            requestBody?: unknown;
            responses?: Record<string, unknown>;
          }
        >
      >;
      components?: { securitySchemes?: Record<string, unknown> };
    };
    const salesPaths = Object.keys(document.paths)
      .filter((path) => path.includes('/sales'))
      .sort();
    expect(salesPaths).toEqual(
      [
        '/api/v1/internal/sales/{saleId}/complete',
        '/api/v1/pos/sales',
        '/api/v1/pos/sales/{saleId}',
        '/api/v1/pos/sales/{saleId}/cancel',
      ].sort(),
    );
    expect(document.components?.securitySchemes).toHaveProperty('tenant-bearer');
    expect(document.components?.securitySchemes).toHaveProperty('internal-bearer');

    for (const path of [
      '/api/v1/pos/sales',
      '/api/v1/pos/sales/{saleId}',
      '/api/v1/pos/sales/{saleId}/cancel',
    ]) {
      for (const [method, operation] of Object.entries(document.paths[path])) {
        if (!['get', 'post', 'patch', 'delete'].includes(method)) continue;
        expect(operation.tags).toEqual(['POS Sales']);
        expect(operation.security).toEqual([{ 'tenant-bearer': [] }]);
      }
    }

    const internal = document.paths['/api/v1/internal/sales/{saleId}/complete'].post;
    expect(internal.tags).toEqual(['Internal Sales']);
    expect(internal.security).toEqual([{ 'internal-bearer': [] }]);
    expect(internal.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'saleId', required: true }),
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
      ]),
    );
    expect(Object.keys(internal.responses ?? {}).sort()).toEqual(
      ['201', '401', '404', '409', '422'].sort(),
    );

    const create = document.paths['/api/v1/pos/sales'].post;
    expect(create.requestBody).toBeDefined();
    expect(create.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        expect.objectContaining({ name: 'If-Match', required: true }),
      ]),
    );
    expect(Object.keys(create.responses ?? {}).sort()).toEqual(
      ['201', '401', '403', '404', '409', '422'].sort(),
    );
  });

  async function createDraftCart(input?: {
    customerId?: string | null;
    quantity?: string;
  }): Promise<string> {
    const cartId = newId();
    await testdb.db.insert(carts).values({
      id: cartId,
      organizationId: organizationA,
      branchId: branchA,
      channel: 'POS',
      status: 'DRAFT',
      customerId: input?.customerId ?? null,
    });
    await testdb.db.insert(cartItems).values({
      id: newId(),
      organizationId: organizationA,
      cartId,
      variantId: variantA,
      unitId: unitA,
      quantity: input?.quantity ?? '1.00000000',
    });
    return cartId;
  }

  async function createHeldCart(): Promise<string> {
    const cartId = await createDraftCart({ quantity: '1.00000000' });
    const reservationId = newId();
    const holdId = newId();
    await testdb.db.insert(reservations).values({
      id: reservationId,
      organizationId: organizationA,
      stockPositionId: null,
      branchId: branchA,
      warehouseId: warehouseA,
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 60_000),
      referenceType: 'CART_HOLD',
      referenceId: holdId,
      referenceVersion: 1,
    });
    await testdb.db.insert(reservationItems).values({
      id: newId(),
      organizationId: organizationA,
      reservationId,
      stockPositionId: stockPositionIdA,
      variantId: variantA,
      quantity: '1.00000000',
    });
    await testdb.client.query(
      `update inventory.stock_positions set reserved = reserved + 1.00000000 where id = $1`,
      [stockPositionIdA],
    );
    await testdb.client.query(
      `insert into cart.cart_holds (id, organization_id, cart_id, branch_id, warehouse_id, cart_version, status, ttl_minutes, policy_version, inventory_reservation_id, expires_at, actor_id, correlation_id, causation_id)
       values ($1,$2,$3,$4,$5,1,'ACTIVE',15,1,$6,$7,$8,$9,$10)`,
      [
        holdId,
        organizationA,
        cartId,
        branchA,
        warehouseA,
        reservationId,
        new Date(Date.now() + 60_000).toISOString(),
        await ownerUserId(),
        'corr-held',
        'cause-held',
      ],
    );
    return cartId;
  }

  async function ownerUserId(): Promise<string> {
    const [owner] = await testdb.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.supabaseUserId, 'sales-http-owner'))
      .limit(1);
    return owner!.id;
  }
});

async function activateTenant(
  db: TestDatabase['db'],
  organizationId: string,
  planCode: string,
): Promise<void> {
  const now = new Date();
  const planId = newId();
  await db
    .insert(plans)
    .values({ id: planId, code: planCode, name: `${planCode} Plan`, status: 'ACTIVE' });
  await db.insert(planEntitlements).values([
    { planId, code: 'branches.max', valueJson: 10 },
    { planId, code: 'warehouses.max', valueJson: 10 },
  ]);
  await db.insert(subscriptions).values({
    id: newId(),
    organizationId,
    planId,
    status: 'ACTIVE',
    billingCycle: 'MONTHLY',
    startedAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 60_000),
  });
  await db.insert(platformTenants).values({
    id: newId(),
    organizationId,
    status: 'ACTIVE',
    provisioningStatus: 'COMPLETED',
  });
}

function jwt(
  subject: string,
  audience: string | string[] = 'tenant-api',
  secret = process.env.SUPABASE_JWT_SECRET!,
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: subject,
      iss: 'https://auth.example.test',
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}

function internalJwt(
  secret: string,
  organizationId: string,
  subject = 'SYSTEM:sales-internal-completion',
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: subject,
      org: organizationId,
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}

function decimalDelta(before: string, after: string): string {
  const scale = 100000000n;
  const b = toScaled(before);
  const a = toScaled(after);
  const diff = b - a;
  return `${diff / scale}.${(diff % scale).toString().padStart(8, '0')}`;
}

function toScaled(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0').slice(0, 8));
}
