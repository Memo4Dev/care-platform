import { createHmac } from 'node:crypto';

import {
  branchAccess,
  businessCustomers,
  cartItems,
  cartHolds,
  carts,
  fifoLayers,
  integrationOutbox,
  newId,
  idempotencyOutcomes,
  planEntitlements,
  plans,
  platformTenants,
  productVariants,
  products,
  subscriptions,
  stockPositions,
  unitDefinitions,
  users,
  warehouses,
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

describe('Cart HTTP boundary', () => {
  let testdb: TestDatabase;
  let app: NestFastifyApplication;
  let ownerBearer: string;
  let deniedBearer: string;
  let foreignOwnerBearer: string;
  let foreignOwnerUserId: string;
  let branchA: string;
  let organizationA: string;
  let unauthorizedBranchA: string;
  let paginationBranchA: string;
  let ownerUserId: string;
  let variantA: string;
  let unitA: string;
  let warehouseA: string;
  let customerA: string;
  let foreignCustomerId: string;
  let foreignOrganizationId: string;
  let foreignBranchB: string;
  let foreignVariantId: string;
  let foreignUnitId: string;
  let foreignCartId: string;
  let foreignItemId: string;
  let nonPosCartId: string;
  let unauthorizedBranchCartId: string;

  beforeAll(async () => {
    testdb = await createTestDatabase();
    process.env.DATABASE_URL = testdb.uri;
    process.env.SUPABASE_JWT_SECRET = 'cart-http-test-secret';
    process.env.SUPABASE_JWT_ISSUER = 'https://auth.example.test';
    process.env.SUPABASE_PLATFORM_AUDIENCE = 'platform-api';
    process.env.SUPABASE_TENANT_AUDIENCE = 'tenant-api';

    const organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    const identityProvisioning = new IdentityProvisioningService(
      testdb.db,
      new UserRepository(),
      new RoleRepository(),
    );

    const tenantA = await organizations.createOrganization({ name: 'Cart HTTP Org A' });
    organizationA = tenantA.organization.id;
    branchA = newId();
    await organizations.createBranch({
      organizationId: organizationA,
      branchId: branchA,
      code: 'CART-A',
      name: 'Cart HTTP Branch A',
    });
    unauthorizedBranchA = newId();
    await organizations.createBranch({
      organizationId: organizationA,
      branchId: unauthorizedBranchA,
      code: 'CART-A-UNAUTHORIZED',
      name: 'Cart HTTP Unauthorized Branch',
    });
    const owner = await identityProvisioning.provisionInitialOwner({
      organizationId: tenantA.organization.id,
      email: 'cart-http-owner@example.test',
      name: 'Cart HTTP Owner',
      supabaseUserId: 'cart-http-owner',
      correlationId: newId(),
      causationId: newId(),
    });
    ownerUserId = owner.user.id;
    await testdb.db.insert(branchAccess).values({
      organizationId: tenantA.organization.id,
      branchId: branchA,
      userId: owner.user.id,
    });
    const deniedUserId = newId();
    await testdb.db.insert(users).values({
      id: deniedUserId,
      organizationId: tenantA.organization.id,
      supabaseUserId: 'cart-http-denied',
      email: 'cart-http-denied@example.test',
      name: 'Cart HTTP Denied',
    });
    await testdb.db.insert(branchAccess).values({
      organizationId: tenantA.organization.id,
      branchId: branchA,
      userId: deniedUserId,
    });
    await activateTenant(testdb.db, organizationA, 'CART_HTTP_A');

    unitA = newId();
    const productA = newId();
    variantA = newId();
    await testdb.db.insert(unitDefinitions).values({
      id: unitA,
      organizationId: organizationA,
      name: 'Cart HTTP Piece',
      symbol: 'pc',
    });
    await testdb.db.insert(products).values({
      id: productA,
      organizationId: organizationA,
      name: 'Cart HTTP Product',
      status: 'ACTIVE',
    });
    await testdb.db.insert(productVariants).values({
      id: variantA,
      organizationId: organizationA,
      productId: productA,
      name: 'Cart HTTP Variant',
      sku: 'CART-HTTP-SKU',
      baseUnitId: unitA,
      status: 'ACTIVE',
    });
    customerA = newId();
    await testdb.db.insert(businessCustomers).values({
      id: customerA,
      organizationId: organizationA,
      type: 'BUSINESS',
      displayName: 'Cart HTTP Customer',
      code: 'CART-CUSTOMER',
    });
    warehouseA = newId();
    await testdb.db.insert(warehouses).values({
      id: warehouseA,
      organizationId: organizationA,
      branchId: branchA,
      code: 'CART-MAIN',
      name: 'Cart Main Warehouse',
    });
    const stockPositionId = newId();
    await testdb.db.insert(stockPositions).values({
      id: stockPositionId,
      organizationId: organizationA,
      warehouseId: warehouseA,
      variantId: variantA,
      onHand: '10.00000000',
    });
    await testdb.db.insert(fifoLayers).values({
      id: newId(),
      organizationId: organizationA,
      stockPositionId,
      quantity: '10.00000000',
      remainingQuantity: '10.00000000',
      unitCost: '1.0000',
    });

    paginationBranchA = newId();
    await organizations.createBranch({
      organizationId: tenantA.organization.id,
      branchId: paginationBranchA,
      code: 'CART-PAGE',
      name: 'Cart HTTP Pagination Branch',
    });
    await testdb.db.insert(branchAccess).values({
      organizationId: tenantA.organization.id,
      branchId: paginationBranchA,
      userId: ownerUserId,
    });

    nonPosCartId = newId();
    unauthorizedBranchCartId = newId();
    await testdb.db.insert(carts).values([
      {
        id: nonPosCartId,
        organizationId: tenantA.organization.id,
        branchId: branchA,
        channel: 'ONLINE',
        status: 'DRAFT',
        customerId: null,
      },
      {
        id: unauthorizedBranchCartId,
        organizationId: tenantA.organization.id,
        branchId: unauthorizedBranchA,
        channel: 'POS',
        status: 'DRAFT',
        customerId: null,
      },
    ]);
    await testdb.db.insert(cartItems).values({
      id: newId(),
      organizationId: tenantA.organization.id,
      cartId: nonPosCartId,
      variantId: variantA,
      unitId: unitA,
      quantity: '1',
    });

    const tenantB = await organizations.createOrganization({ name: 'Cart HTTP Org B' });
    foreignOrganizationId = tenantB.organization.id;
    foreignBranchB = newId();
    await organizations.createBranch({
      organizationId: tenantB.organization.id,
      branchId: foreignBranchB,
      code: 'CART-B',
      name: 'Cart HTTP Branch B',
    });
    const foreignOwner = await identityProvisioning.provisionInitialOwner({
      organizationId: tenantB.organization.id,
      email: 'cart-http-foreign-owner@example.test',
      name: 'Cart HTTP Foreign Owner',
      supabaseUserId: 'cart-http-foreign-owner',
      correlationId: newId(),
      causationId: newId(),
    });
    foreignOwnerUserId = foreignOwner.user.id;
    await testdb.db.insert(branchAccess).values({
      organizationId: tenantB.organization.id,
      branchId: foreignBranchB,
      userId: foreignOwner.user.id,
    });
    await activateTenant(testdb.db, tenantB.organization.id, 'CART_HTTP_B');

    foreignUnitId = newId();
    const foreignProductId = newId();
    foreignVariantId = newId();
    await testdb.db.insert(unitDefinitions).values({
      id: foreignUnitId,
      organizationId: tenantB.organization.id,
      name: 'Cart HTTP Foreign Piece',
      symbol: 'fpc',
    });
    await testdb.db.insert(products).values({
      id: foreignProductId,
      organizationId: tenantB.organization.id,
      name: 'Cart HTTP Foreign Product',
      status: 'ACTIVE',
    });
    await testdb.db.insert(productVariants).values({
      id: foreignVariantId,
      organizationId: tenantB.organization.id,
      productId: foreignProductId,
      name: 'Cart HTTP Foreign Variant',
      sku: 'CART-HTTP-FOREIGN-SKU',
      baseUnitId: foreignUnitId,
      status: 'ACTIVE',
    });
    foreignCustomerId = newId();
    await testdb.db.insert(businessCustomers).values({
      id: foreignCustomerId,
      organizationId: tenantB.organization.id,
      type: 'BUSINESS',
      displayName: 'Cart HTTP Foreign Customer',
      code: 'CART-FOREIGN-CUSTOMER',
    });

    ownerBearer = jwt('cart-http-owner');
    deniedBearer = jwt('cart-http-denied');
    foreignOwnerBearer = jwt('cart-http-foreign-owner');
    app = await createApp();
    setupSwagger(app);
    await app.init();

    const foreignCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${foreignOwnerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: foreignBranchB },
    });
    expect(foreignCreate.statusCode).toBe(201);
    foreignCartId = foreignCreate.json().data.id;
    foreignItemId = newId();
    await testdb.db.insert(cartItems).values({
      id: foreignItemId,
      organizationId: foreignOrganizationId,
      cartId: foreignCartId,
      variantId: foreignVariantId,
      unitId: foreignUnitId,
      quantity: '1',
    });
  });

  afterAll(async () => {
    await app?.close();
    await app?.get(DATABASE).$client.end();
    await testdb?.teardown();
  });

  it('requires a verified tenant JWT and reports the standard error envelope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${branchA}`,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED', correlationId: expect.any(String) },
    });
  });

  it('documents only the canonical POS Cart routes with tenant bearer authentication', async () => {
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
    const cartPaths = Object.keys(document.paths)
      .filter((path) => path.includes('/carts'))
      .sort();
    expect(cartPaths).toEqual(
      [
        '/api/v1/pos/carts',
        '/api/v1/pos/carts/{cartId}',
        '/api/v1/pos/carts/{cartId}/items',
        '/api/v1/pos/carts/{cartId}/items/{itemId}',
        '/api/v1/pos/carts/{cartId}/hold',
        '/api/v1/pos/carts/{cartId}/resume',
        '/api/v1/pos/carts/{cartId}/save',
      ].sort(),
    );
    expect(document.components?.securitySchemes).toHaveProperty('tenant-bearer');

    for (const path of cartPaths) {
      for (const [method, operation] of Object.entries(document.paths[path])) {
        if (!['get', 'post', 'patch', 'delete'].includes(method)) continue;
        expect(operation.tags).toEqual(['POS Cart']);
        expect(operation.security).toEqual([{ 'tenant-bearer': [] }]);
      }
    }

    const save = document.paths['/api/v1/pos/carts/{cartId}/save'].post;
    expect(save.requestBody).toBeUndefined();
    expect(save.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'cartId', required: true }),
        expect.objectContaining({ name: 'Idempotency-Key', required: true }),
        expect.objectContaining({ name: 'If-Match', required: true }),
      ]),
    );
    expect(Object.keys(save.responses ?? {}).sort()).toEqual(
      ['200', '401', '403', '404', '409', '422'].sort(),
    );
  });

  it('rejects wrong/ambiguous-audience and bad-signature JWTs with standard 401 errors', async () => {
    const wrongAudience = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${branchA}`,
      headers: {
        authorization: `Bearer ${jwt('cart-http-owner', 'platform-api')}`,
      },
    });
    const badSignature = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${branchA}`,
      headers: {
        authorization: `Bearer ${jwt('cart-http-owner', 'tenant-api', 'wrong-cart-http-secret')}`,
      },
    });
    const ambiguousAudience = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${branchA}`,
      headers: {
        authorization: `Bearer ${jwt('cart-http-owner', ['tenant-api', 'platform-api'])}`,
      },
    });

    for (const response of [wrongAudience, ambiguousAudience, badSignature]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: expect.any(String),
          correlationId: expect.any(String),
        },
      });
    }
  });

  it('rejects wrong-issuer and expired tenant JWTs', async () => {
    const wrongIssuer = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${branchA}`,
      headers: {
        authorization: `Bearer ${jwt('cart-http-owner', 'tenant-api', process.env.SUPABASE_JWT_SECRET!, { issuer: 'https://attacker.example.test' })}`,
      },
    });
    const expired = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${branchA}`,
      headers: {
        authorization: `Bearer ${jwt('cart-http-owner', 'tenant-api', process.env.SUPABASE_JWT_SECRET!, { expiresAt: Math.floor(Date.now() / 1000) - 1 })}`,
      },
    });

    for (const response of [wrongIssuer, expired]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: { code: 'INVALID_CREDENTIALS', correlationId: expect.any(String) },
      });
    }
  });

  it('denies a tenant user without sales.create', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${deniedBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
  });

  it('fails closed for incomplete/unavailable tenants and suspended POS operators', async () => {
    try {
      await testdb.db
        .update(platformTenants)
        .set({ provisioningStatus: 'PENDING' })
        .where(eq(platformTenants.organizationId, foreignOrganizationId));
      const incomplete = await app.inject({
        method: 'GET',
        url: `/api/v1/pos/carts?branchId=${foreignBranchB}`,
        headers: { authorization: `Bearer ${foreignOwnerBearer}` },
      });
      expect(incomplete.statusCode).toBe(409);
      expect(incomplete.json()).toMatchObject({
        error: { code: 'TENANT_PROVISIONING_INCOMPLETE', correlationId: expect.any(String) },
      });

      await testdb.db
        .update(platformTenants)
        .set({
          provisioningStatus: 'COMPLETED',
          status: 'SUSPENDED',
          suspendedReason: 'HTTP boundary security test',
        })
        .where(eq(platformTenants.organizationId, foreignOrganizationId));
      const suspendedTenant = await app.inject({
        method: 'GET',
        url: `/api/v1/pos/carts?branchId=${foreignBranchB}`,
        headers: { authorization: `Bearer ${foreignOwnerBearer}` },
      });
      expect(suspendedTenant.statusCode).toBe(403);
      expect(suspendedTenant.json()).toMatchObject({ error: { code: 'TENANT_SUSPENDED' } });

      await testdb.db
        .update(platformTenants)
        .set({ status: 'CLOSED' })
        .where(eq(platformTenants.organizationId, foreignOrganizationId));
      const closedTenant = await app.inject({
        method: 'GET',
        url: `/api/v1/pos/carts?branchId=${foreignBranchB}`,
        headers: { authorization: `Bearer ${foreignOwnerBearer}` },
      });
      expect(closedTenant.statusCode).toBe(403);
      expect(closedTenant.json()).toMatchObject({ error: { code: 'TENANT_SUSPENDED' } });

      await testdb.db
        .update(platformTenants)
        .set({ status: 'ACTIVE' })
        .where(eq(platformTenants.organizationId, foreignOrganizationId));
      await testdb.db
        .update(users)
        .set({ status: 'SUSPENDED' })
        .where(eq(users.supabaseUserId, 'cart-http-foreign-owner'));
      const suspendedOperator = await app.inject({
        method: 'GET',
        url: `/api/v1/pos/carts?branchId=${foreignBranchB}`,
        headers: { authorization: `Bearer ${foreignOwnerBearer}` },
      });
      expect(suspendedOperator.statusCode).toBe(403);
      expect(suspendedOperator.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    } finally {
      await testdb.db
        .update(platformTenants)
        .set({ provisioningStatus: 'COMPLETED', status: 'ACTIVE', suspendedReason: null })
        .where(eq(platformTenants.organizationId, foreignOrganizationId));
      await testdb.db
        .update(users)
        .set({ status: 'ACTIVE' })
        .where(eq(users.supabaseUserId, 'cart-http-foreign-owner'));
    }
  });

  it('keeps the POS Cart surface limited to POS carts below the controller', async () => {
    const getNonPos = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts/${nonPosCartId}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(getNonPos.statusCode).toBe(404);
    expect(getNonPos.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } });

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${branchA}&limit=100`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: nonPosCartId })]),
    );

    const mutateNonPos = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${nonPosCartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '1' },
    });
    expect(mutateNonPos.statusCode).toBe(404);
    const [unchanged] = await testdb.db
      .select({ version: carts.version })
      .from(carts)
      .where(eq(carts.id, nonPosCartId));
    expect(unchanged?.version).toBe(1);
  });

  it('enforces unauthorized branch access for Cart reads and list queries', async () => {
    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts/${unauthorizedBranchCartId}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(get.statusCode).toBe(403);
    expect(get.json()).toMatchObject({ error: { code: 'BRANCH_ACCESS_DENIED' } });

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${unauthorizedBranchA}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(list.statusCode).toBe(403);
    expect(list.json()).toMatchObject({ error: { code: 'BRANCH_ACCESS_DENIED' } });
  });

  it('rejects a mutation on an inaccessible same-tenant branch without changing the Cart', async () => {
    const [beforeCart] = await testdb.db
      .select({ version: carts.version })
      .from(carts)
      .where(and(eq(carts.id, unauthorizedBranchCartId), eq(carts.organizationId, organizationA)));
    const beforeLines = await testdb.db
      .select({ id: cartItems.id })
      .from(cartItems)
      .where(
        and(
          eq(cartItems.cartId, unauthorizedBranchCartId),
          eq(cartItems.organizationId, organizationA),
        ),
      );
    const idempotencyKey = newId();
    expect(beforeCart).toMatchObject({ version: 1 });
    expect(beforeLines).toHaveLength(0);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${unauthorizedBranchCartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': idempotencyKey,
        'if-match': String(beforeCart?.version),
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '1' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: 'BRANCH_ACCESS_DENIED', correlationId: expect.any(String) },
    });

    const saveResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${unauthorizedBranchCartId}/save`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
    });
    expect(saveResponse.statusCode).toBe(403);
    expect(saveResponse.json()).toMatchObject({ error: { code: 'BRANCH_ACCESS_DENIED' } });

    const [afterCart] = await testdb.db
      .select({ version: carts.version })
      .from(carts)
      .where(and(eq(carts.id, unauthorizedBranchCartId), eq(carts.organizationId, organizationA)));
    const afterLines = await testdb.db
      .select({ id: cartItems.id })
      .from(cartItems)
      .where(
        and(
          eq(cartItems.cartId, unauthorizedBranchCartId),
          eq(cartItems.organizationId, organizationA),
        ),
      );
    const outcomes = await testdb.db
      .select({ id: idempotencyOutcomes.id })
      .from(idempotencyOutcomes)
      .where(
        and(
          eq(
            idempotencyOutcomes.scope,
            `ORGANIZATION_USER:${ownerUserId}:${organizationA}:POST:/api/v1/pos/carts/:cartId/items`,
          ),
          eq(idempotencyOutcomes.idempotencyKey, idempotencyKey),
        ),
      );

    expect(afterCart?.version).toBe(beforeCart?.version);
    expect(afterLines).toEqual(beforeLines);
    expect(outcomes).toHaveLength(0);
  });

  it('rejects a branch from another organization without creating a Cart', async () => {
    const beforeCount = await cartCount(testdb.db, organizationA);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: foreignBranchB },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: expect.any(String),
        correlationId: expect.any(String),
      },
    });
    expect(await cartCount(testdb.db, organizationA)).toBe(beforeCount);
  });

  it('rejects a cross-tenant customer reference without creating a Cart', async () => {
    const beforeCount = await cartCount(testdb.db, organizationA);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA, customerId: foreignCustomerId },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: expect.any(String),
        correlationId: expect.any(String),
      },
    });
    expect(await cartCount(testdb.db, organizationA)).toBe(beforeCount);
  });

  it('rejects a cross-tenant variant item reference without changing the Cart', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    expect(created.statusCode).toBe(201);
    const cartId = created.json().data.id as string;
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: foreignVariantId, unitId: foreignUnitId, quantity: '1' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: expect.any(String),
        correlationId: expect.any(String),
      },
    });
    const [cart] = await testdb.db
      .select({ version: carts.version })
      .from(carts)
      .where(and(eq(carts.id, cartId), eq(carts.organizationId, organizationA)));
    const lines = await testdb.db
      .select({ id: cartItems.id })
      .from(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.organizationId, organizationA)));
    expect(cart?.version).toBe(1);
    expect(lines).toHaveLength(0);
  });

  it('rejects a cross-tenant unit reference and rolls back the Cart mutation', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    const cartId = created.json().data.id as string;
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: foreignUnitId, quantity: '1' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        details: { reference: 'unitId' },
        correlationId: expect.any(String),
      },
    });
    const unchanged = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts/${cartId}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(unchanged.json()).toMatchObject({ data: { version: 1, items: [] } });
  });

  it('masks foreign Cart mutations and foreign nested item IDs', async () => {
    const foreignAdd = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${foreignCartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '1' },
    });
    const foreignSave = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${foreignCartId}/save`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
    });
    expect(foreignAdd.statusCode).toBe(404);
    expect(foreignSave.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    const cartId = created.json().data.id as string;
    const patchForeignItem = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pos/carts/${cartId}/items/${foreignItemId}`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { quantity: '2' },
    });
    const deleteForeignItem = await app.inject({
      method: 'DELETE',
      url: `/api/v1/pos/carts/${cartId}/items/${foreignItemId}`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
    });
    expect(patchForeignItem.statusCode).toBe(404);
    expect(deleteForeignItem.statusCode).toBe(404);
    const unchanged = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts/${cartId}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(unchanged.json()).toMatchObject({ data: { version: 1, items: [] } });
  });

  it('isolates the same idempotency key across authenticated actors and organizations', async () => {
    const key = newId();
    const tenantA = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': key },
      payload: { branchId: branchA },
    });
    const tenantB = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${foreignOwnerBearer}`, 'idempotency-key': key },
      payload: { branchId: foreignBranchB },
    });

    expect(tenantA.statusCode).toBe(201);
    expect(tenantB.statusCode).toBe(201);
    expect(tenantB.json().data.id).not.toBe(tenantA.json().data.id);
    const outcomes = await testdb.db
      .select({ scope: idempotencyOutcomes.scope })
      .from(idempotencyOutcomes)
      .where(eq(idempotencyOutcomes.idempotencyKey, key));
    expect(outcomes).toHaveLength(2);
    expect(new Set(outcomes.map((outcome) => outcome.scope))).toEqual(
      new Set([
        `ORGANIZATION_USER:${ownerUserId}:${organizationA}:POST:/api/v1/pos/carts`,
        `ORGANIZATION_USER:${foreignOwnerUserId}:${foreignOrganizationId}:POST:/api/v1/pos/carts`,
      ]),
    );
  });

  it('creates and mutates a POS Draft through the authenticated HTTP boundary', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA, customerId: customerA },
    });
    expect(created.statusCode).toBe(201);
    const cartId = created.json().data.id;
    expect(created.json()).toMatchObject({
      data: { id: cartId, channel: 'POS', status: 'DRAFT', customerId: customerA, version: 1 },
    });

    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '2.5' },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({
      data: { id: cartId, version: 2, items: [{ quantity: '2.50000000' }] },
    });
    const itemId = added.json().data.items[0].id;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pos/carts/${cartId}/items/${itemId}`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
      payload: { quantity: '3' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      data: { version: 3, items: [{ quantity: '3.00000000' }] },
    });

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/pos/carts/${cartId}/items/${itemId}`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '3',
      },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ data: { id: cartId, version: 4, items: [] } });
  });

  it('saves and replays an exact no-op Cart snapshot with version-bound idempotency', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    expect(created.statusCode).toBe(201);
    const cartId = created.json().data.id as string;
    const outboxBeforeSave = await testdb.db
      .select({ id: integrationOutbox.id })
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, cartId));
    const saveKey = newId();
    const saveRequest = {
      method: 'POST' as const,
      url: `/api/v1/pos/carts/${cartId}/save`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': saveKey,
        'if-match': '1',
      },
    };

    const saved = await app.inject(saveRequest);
    expect(saved.statusCode).toBe(200);
    expect(saved.body).toBe(created.body);
    expect(saved.json()).toMatchObject({ data: { version: 1, status: 'DRAFT', items: [] } });
    expect(
      await testdb.db
        .select({ id: integrationOutbox.id })
        .from(integrationOutbox)
        .where(eq(integrationOutbox.aggregateId, cartId)),
    ).toEqual(outboxBeforeSave);

    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '1' },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toMatchObject({
      data: { version: 2, items: [{ quantity: '1.00000000' }] },
    });

    const replay = await app.inject(saveRequest);
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toBe(saved.body);

    const changedExpectedVersion = await app.inject({
      ...saveRequest,
      headers: { ...saveRequest.headers, 'if-match': '2' },
    });
    expect(changedExpectedVersion.statusCode).toBe(409);
    expect(changedExpectedVersion.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT', correlationId: expect.any(String) },
    });

    const staleDistinctKey = await app.inject({
      ...saveRequest,
      headers: {
        ...saveRequest.headers,
        'idempotency-key': newId(),
        'if-match': '1',
      },
    });
    expect(staleDistinctKey.statusCode).toBe(409);
    expect(staleDistinctKey.json()).toMatchObject({
      error: {
        code: 'RESOURCE_VERSION_CONFLICT',
        details: { cartId, expectedVersion: 1 },
        correlationId: expect.any(String),
      },
    });

    const savedCurrent = await app.inject({
      ...saveRequest,
      headers: {
        ...saveRequest.headers,
        'idempotency-key': newId(),
        'if-match': '2',
      },
    });
    expect(savedCurrent.statusCode).toBe(200);
    expect(savedCurrent.body).toBe(added.body);

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts/${cartId}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${branchA}&limit=100`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.body).toBe(savedCurrent.body);
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: cartId, version: 2 })]),
    );
  });

  it('holds all Cart items in one warehouse, blocks edits, and resumes by releasing Inventory', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    expect(created.statusCode).toBe(201);
    const cartId = created.json().data.id as string;
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '2' },
    });
    expect(added.statusCode).toBe(200);
    const itemId = added.json().data.items[0].id as string;

    const held = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/hold`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
      payload: { warehouseId: warehouseA },
    });
    expect(held.statusCode).toBe(200);
    expect(held.json()).toMatchObject({
      data: {
        id: cartId,
        version: 2,
        hold: { status: 'ACTIVE', warehouseId: warehouseA, shortages: [] },
      },
    });

    const editWhileHeld = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pos/carts/${cartId}/items/${itemId}`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
      payload: { quantity: '3' },
    });
    expect(editWhileHeld.statusCode).toBe(403);
    expect(editWhileHeld.json()).toMatchObject({ error: { code: 'OPERATION_NOT_ALLOWED' } });

    const resumed = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/resume`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({
      data: { id: cartId, version: 2, hold: { status: 'RELEASED', shortages: [] } },
    });

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts/${cartId}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ data: { id: cartId, hold: null } });

    const editAfterResume = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pos/carts/${cartId}/items/${itemId}`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
      payload: { quantity: '3' },
    });
    expect(editAfterResume.statusCode).toBe(200);
    expect(editAfterResume.json()).toMatchObject({ data: { version: 3 } });
  });

  it('returns explicit shortages for unsatisfied hold without making the Cart non-editable', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    expect(created.statusCode).toBe(201);
    const cartId = created.json().data.id as string;
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '20' },
    });
    expect(added.statusCode).toBe(200);
    const itemId = added.json().data.items[0].id as string;

    const held = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/hold`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
      payload: { warehouseId: warehouseA },
    });

    expect(held.statusCode).toBe(200);
    expect(held.json()).toMatchObject({
      data: {
        id: cartId,
        version: 2,
        hold: {
          status: 'FAILED',
          shortages: [{ variantId: variantA, requested: '20.00000000' }],
        },
      },
    });
    const [hold] = await testdb.db
      .select({
        status: cartHolds.status,
        inventoryReservationId: cartHolds.inventoryReservationId,
      })
      .from(cartHolds)
      .where(and(eq(cartHolds.organizationId, organizationA), eq(cartHolds.cartId, cartId)));
    expect(hold).toEqual({ status: 'FAILED', inventoryReservationId: null });

    const editAfterShortage = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pos/carts/${cartId}/items/${itemId}`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
      payload: { quantity: '1' },
    });
    expect(editAfterShortage.statusCode).toBe(200);
    expect(editAfterShortage.json()).toMatchObject({ data: { version: 3 } });
  });

  it('replays a create when customerId is omitted or explicitly null', async () => {
    const idempotencyKey = newId();
    const omitted = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': idempotencyKey },
      payload: { branchId: branchA },
    });
    const explicitNull = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': idempotencyKey },
      payload: { branchId: branchA, customerId: null },
    });

    expect(omitted.statusCode).toBe(201);
    expect(explicitNull.statusCode).toBe(201);
    expect(explicitNull.body).toBe(omitted.body);
  });

  it('returns cursor page metadata and rejects invalid Cart cursors', async () => {
    const firstCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: paginationBranchA },
    });
    const secondCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: paginationBranchA },
    });
    expect(firstCreate.statusCode).toBe(201);
    expect(secondCreate.statusCode).toBe(201);
    const expectedIds = new Set([firstCreate.json().data.id, secondCreate.json().data.id]);

    const firstPage = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${paginationBranchA}&limit=1`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json()).toMatchObject({
      data: [expect.objectContaining({ channel: 'POS', status: 'DRAFT' })],
      page: { nextCursor: expect.any(String), hasMore: true },
    });

    const secondPage = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${paginationBranchA}&limit=1&after=${encodeURIComponent(firstPage.json().page.nextCursor)}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json()).toMatchObject({
      data: [expect.objectContaining({ channel: 'POS', status: 'DRAFT' })],
      page: { nextCursor: null, hasMore: false },
    });
    expect(new Set([firstPage.json().data[0].id, secondPage.json().data[0].id])).toEqual(
      expectedIds,
    );

    const invalid = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts?branchId=${paginationBranchA}&after=invalid-cursor`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        details: { field: 'after' },
        correlationId: expect.any(String),
      },
    });
  });

  it('rejects invalid Cart bodies and optimistic-concurrency headers at the HTTP boundary', async () => {
    const invalidBody = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA, unexpected: true },
    });
    expect(invalidBody.statusCode).toBe(422);
    expect(invalidBody.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', correlationId: expect.any(String) },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    const cartId = created.json().data.id;
    const missingVersion = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { variantId: variantA, unitId: unitA, quantity: '1' },
    });
    expect(missingVersion.statusCode).toBe(422);
    expect(missingVersion.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', correlationId: expect.any(String) },
    });

    const malformedVersion = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1.0',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '1' },
    });
    expect(malformedVersion.statusCode).toBe(422);
    expect(malformedVersion.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { field: 'If-Match' } },
    });
  });

  it('rejects caller-supplied authority fields and bodies on bodyless commands', async () => {
    const authorityFields: Array<[string, unknown]> = [
      ['organizationId', organizationA],
      ['organizationUserId', ownerUserId],
      ['userId', ownerUserId],
      ['actorId', ownerUserId],
      ['operatorId', ownerUserId],
      ['role', 'OWNER'],
      ['roles', ['OWNER']],
      ['permission', 'sales.create'],
      ['permissions', ['sales.create']],
      ['deviceId', newId()],
    ];
    for (const [field, value] of authorityFields) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/pos/carts',
        headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
        payload: { branchId: branchA, [field]: value },
      });
      expect(response.statusCode, field).toBe(422);
      expect(response.json(), field).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    const cartId = created.json().data.id as string;
    const rejectedAdd = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '1', operatorId: ownerUserId },
    });
    expect(rejectedAdd.statusCode).toBe(422);

    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '1' },
    });
    expect(added.statusCode).toBe(200);
    const itemId = added.json().data.items[0].id as string;

    const rejectedUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/pos/carts/${cartId}/items/${itemId}`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
      payload: { quantity: '2', permissions: ['sales.create'] },
    });
    const rejectedRemove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/pos/carts/${cartId}/items/${itemId}`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
      payload: { role: 'OWNER' },
    });
    const rejectedSave = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/save`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
      payload: { deviceId: newId() },
    });
    const rejectedEmptySaveBody = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/save`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '2',
      },
      payload: {},
    });
    for (const response of [rejectedUpdate, rejectedRemove, rejectedSave, rejectedEmptySaveBody]) {
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }

    const missingSaveKey = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/save`,
      headers: { authorization: `Bearer ${ownerBearer}`, 'if-match': '2' },
    });
    const missingSaveVersion = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/save`,
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
    });
    expect(missingSaveKey.statusCode).toBe(422);
    expect(missingSaveVersion.statusCode).toBe(422);

    const unchanged = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts/${cartId}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(unchanged.json()).toMatchObject({ data: { version: 2, items: [{ id: itemId }] } });
  });

  it('replays item mutations only when body and If-Match version both match', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    const cartId = created.json().data.id;
    const addKey = newId();
    const addRequest = {
      method: 'POST' as const,
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': addKey,
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '1' },
    };
    const added = await app.inject(addRequest);
    const addedReplay = await app.inject(addRequest);
    expect(added.statusCode).toBe(200);
    expect(addedReplay.statusCode).toBe(200);
    expect(addedReplay.body).toBe(added.body);

    const changedVersion = await app.inject({
      ...addRequest,
      headers: { ...addRequest.headers, 'if-match': '2' },
    });
    expect(changedVersion.statusCode).toBe(409);
    expect(changedVersion.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT', correlationId: expect.any(String) },
    });

    const itemId = added.json().data.items[0].id;
    const updateKey = newId();
    const updateRequest = {
      method: 'PATCH' as const,
      url: `/api/v1/pos/carts/${cartId}/items/${itemId}`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': updateKey,
        'if-match': '2',
      },
      payload: { quantity: '2' },
    };
    const updated = await app.inject(updateRequest);
    const updatedReplay = await app.inject(updateRequest);
    expect(updated.statusCode).toBe(200);
    expect(updatedReplay.body).toBe(updated.body);
    const updateConflict = await app.inject({
      ...updateRequest,
      headers: { ...updateRequest.headers, 'if-match': '3' },
    });
    expect(updateConflict.statusCode).toBe(409);
    expect(updateConflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });

    const removeKey = newId();
    const removeRequest = {
      method: 'DELETE' as const,
      url: `/api/v1/pos/carts/${cartId}/items/${itemId}`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': removeKey,
        'if-match': '3',
      },
    };
    const removed = await app.inject(removeRequest);
    const removedReplay = await app.inject(removeRequest);
    expect(removed.statusCode).toBe(200);
    expect(removedReplay.body).toBe(removed.body);
    const removeConflict = await app.inject({
      ...removeRequest,
      headers: { ...removeRequest.headers, 'if-match': '4' },
    });
    expect(removeConflict.statusCode).toBe(409);
    expect(removeConflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('reports the actual Cart ID for a stale version in the serialized HTTP error', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    const cartId = created.json().data.id;
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '1' },
    });
    expect(added.statusCode).toBe(200);

    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '1' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      error: {
        code: 'RESOURCE_VERSION_CONFLICT',
        message: `Cart ${cartId} was modified concurrently.`,
        details: { cartId, expectedVersion: 1 },
        correlationId: expect.any(String),
      },
    });
    expect(stale.body).not.toContain('"cart"');
  });

  it('returns 404 for every obsolete admin Cart and /lines route shape', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: branchA },
    });
    const cartId = created.json().data.id as string;
    const added = await app.inject({
      method: 'POST',
      url: `/api/v1/pos/carts/${cartId}/items`,
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { variantId: variantA, unitId: unitA, quantity: '1' },
    });
    const itemId = added.json().data.items[0].id as string;
    const headers = {
      authorization: `Bearer ${ownerBearer}`,
      'idempotency-key': newId(),
      'if-match': '2',
    };
    const obsoleteRequests = [
      { method: 'GET' as const, url: `/api/v1/admin/carts?branchId=${branchA}` },
      {
        method: 'POST' as const,
        url: '/api/v1/admin/carts',
        headers,
        payload: { branchId: branchA },
      },
      { method: 'GET' as const, url: `/api/v1/admin/carts/${cartId}` },
      {
        method: 'POST' as const,
        url: `/api/v1/admin/carts/${cartId}/lines`,
        headers,
        payload: { variantId: variantA, unitId: unitA, quantity: '1' },
      },
      {
        method: 'PATCH' as const,
        url: `/api/v1/admin/carts/${cartId}/lines/${itemId}`,
        headers,
        payload: { quantity: '2' },
      },
      {
        method: 'DELETE' as const,
        url: `/api/v1/admin/carts/${cartId}/lines/${itemId}`,
        headers,
      },
      {
        method: 'POST' as const,
        url: `/api/v1/admin/carts/${cartId}/items`,
        headers,
        payload: { variantId: variantA, unitId: unitA, quantity: '1' },
      },
      {
        method: 'PATCH' as const,
        url: `/api/v1/admin/carts/${cartId}/items/${itemId}`,
        headers,
        payload: { quantity: '2' },
      },
      {
        method: 'DELETE' as const,
        url: `/api/v1/admin/carts/${cartId}/items/${itemId}`,
        headers,
      },
      {
        method: 'POST' as const,
        url: `/api/v1/admin/carts/${cartId}/save`,
        headers,
      },
      {
        method: 'POST' as const,
        url: `/api/v1/pos/carts/${cartId}/lines`,
        headers,
        payload: { variantId: variantA, unitId: unitA, quantity: '1' },
      },
      {
        method: 'PATCH' as const,
        url: `/api/v1/pos/carts/${cartId}/lines/${itemId}`,
        headers,
        payload: { quantity: '2' },
      },
      {
        method: 'DELETE' as const,
        url: `/api/v1/pos/carts/${cartId}/lines/${itemId}`,
        headers,
      },
    ];

    for (const request of obsoleteRequests) {
      const response = await app.inject(request);
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(404);
    }
  });

  it('masks a foreign Cart IDOR and rejects malformed or stale mutation headers', async () => {
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/v1/pos/carts/${foreignCartId}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } });

    const malformed = await app.inject({
      method: 'GET',
      url: '/api/v1/pos/carts/not-a-uuid',
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(malformed.statusCode).toBe(422);

    const missingKey = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/carts',
      headers: { authorization: `Bearer ${ownerBearer}` },
      payload: { branchId: branchA },
    });
    expect(missingKey.statusCode).toBe(422);
  });
});

async function cartCount(db: TestDatabase['db'], organizationId: string): Promise<number> {
  const rows = await db
    .select({ id: carts.id })
    .from(carts)
    .where(eq(carts.organizationId, organizationId));
  return rows.length;
}

async function activateTenant(
  db: TestDatabase['db'],
  organizationId: string,
  planCode: string,
): Promise<void> {
  const now = new Date();
  const planId = newId();
  await db.insert(plans).values({
    id: planId,
    code: planCode,
    name: `${planCode} Plan`,
    status: 'ACTIVE',
  });
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
  overrides: { issuer?: string; expiresAt?: number } = {},
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: subject,
      iss: overrides.issuer ?? 'https://auth.example.test',
      aud: audience,
      exp: overrides.expiresAt ?? Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}
