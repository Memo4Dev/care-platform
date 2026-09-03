import { createHmac } from 'node:crypto';

import {
  branchAccess,
  cartItems,
  carts,
  fifoLayers,
  newId,
  planEntitlements,
  plans,
  platformTenants,
  priceBooks,
  priceEntries,
  productVariants,
  products,
  reservations,
  sales,
  stockPositions,
  subscriptions,
  unitDefinitions,
  warehouses,
} from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../main';
import { DATABASE } from '../database/database.tokens';
import { IdentityProvisioningService } from '../identity/application/identity-provisioning.service';
import { RoleRepository } from '../identity/infrastructure/role.repository';
import { UserRepository } from '../identity/infrastructure/user.repository';
import { OrganizationService } from '../organization/application/organization.service';
import { OrganizationRepository } from '../organization/infrastructure/organization.repository';

describe('Sales checkout concurrency', () => {
  let testdb: TestDatabase;
  let app: NestFastifyApplication;
  let bearer: string;
  let organizationId: string;
  let branchId: string;
  let warehouseId: string;
  let unitId: string;
  let variantId: string;
  let stockPositionId: string;

  beforeAll(async () => {
    testdb = await createTestDatabase();
    process.env.DATABASE_URL = testdb.uri;
    process.env.SUPABASE_JWT_SECRET = 'sales-concurrency-secret';
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

    const tenant = await organizations.createOrganization({ name: 'Sales Concurrency Org' });
    organizationId = tenant.organization.id;
    branchId = newId();
    await organizations.createBranch({
      organizationId,
      branchId,
      code: 'SLS-CON',
      name: 'Sales Concurrency Branch',
    });
    const owner = await identityProvisioning.provisionInitialOwner({
      organizationId,
      email: 'sales-concurrency-owner@example.test',
      name: 'Sales Concurrency Owner',
      supabaseUserId: 'sales-concurrency-owner',
      correlationId: newId(),
      causationId: newId(),
    });
    await testdb.db
      .insert(branchAccess)
      .values({ organizationId, branchId, userId: owner.user.id });
    await activateTenant(testdb.db, organizationId, 'SALES_CONCURRENCY');

    unitId = newId();
    const productId = newId();
    variantId = newId();
    warehouseId = newId();
    stockPositionId = newId();
    await testdb.db.insert(unitDefinitions).values({
      id: unitId,
      organizationId,
      name: 'Piece',
      symbol: 'pc',
    });
    await testdb.db.insert(products).values({
      id: productId,
      organizationId,
      name: 'Concurrent Product',
      status: 'ACTIVE',
    });
    await testdb.db.insert(productVariants).values({
      id: variantId,
      organizationId,
      productId,
      name: 'Concurrent Variant',
      sku: 'CON-SKU',
      baseUnitId: unitId,
      status: 'ACTIVE',
    });
    await testdb.db.insert(warehouses).values({
      id: warehouseId,
      organizationId,
      branchId,
      code: 'MAIN',
      name: 'Main Warehouse',
    });
    await testdb.db.insert(stockPositions).values({
      id: stockPositionId,
      organizationId,
      warehouseId,
      variantId,
      onHand: '5.00000000',
      reserved: '0.00000000',
      allocated: '0.00000000',
    });
    await testdb.db.insert(fifoLayers).values({
      id: newId(),
      organizationId,
      stockPositionId,
      quantity: '5.00000000',
      remainingQuantity: '5.00000000',
      unitCost: '1.0000',
    });
    const priceBookId = newId();
    await testdb.db.insert(priceBooks).values({
      id: priceBookId,
      organizationId,
      name: 'Default',
      isDefault: true,
      isActive: true,
    });
    await testdb.db.insert(priceEntries).values({
      id: newId(),
      organizationId,
      priceBookId,
      variantId,
      unitId,
      priceType: 'CASH',
      channel: 'POS',
      branchId,
      amount: '10.00',
      effectiveFrom: new Date('2020-01-01'),
    });

    bearer = jwt('sales-concurrency-owner');
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await app?.get(DATABASE).$client.end();
    await testdb?.teardown();
  });

  it('allows at most one checkout for the same cart/version with distinct keys', async () => {
    const cartId = newId();
    await testdb.db.insert(carts).values({
      id: cartId,
      organizationId,
      branchId,
      channel: 'POS',
      status: 'DRAFT',
      customerId: null,
    });
    await testdb.db.insert(cartItems).values({
      id: newId(),
      organizationId,
      cartId,
      variantId,
      unitId,
      quantity: '1.00000000',
    });

    const run = (key: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/pos/sales',
        headers: {
          authorization: `Bearer ${bearer}`,
          'idempotency-key': key,
          'if-match': '1',
        },
        payload: { cartId, warehouseId, priceType: 'CASH' },
      });

    const [a, b] = await Promise.allSettled([run(newId()), run(newId())]);
    const responses = [a, b].map((result) =>
      result.status === 'fulfilled' ? result.value : result.reason,
    );
    const statusCodes = responses.map((response) => response.statusCode).sort();
    expect(statusCodes).toEqual([201, 409]);

    const stored = await testdb.db
      .select({ id: sales.id })
      .from(sales)
      .where(and(eq(sales.organizationId, organizationId), eq(sales.cartId, cartId)));
    expect(stored).toHaveLength(1);
  });

  it('consumes FIFO stock exactly once when complete is replayed concurrently', async () => {
    const { saleId, reservationId } = await createPendingSale('2.00000000');
    const readStock = async () => {
      const [row] = await testdb.db
        .select({ onHand: stockPositions.onHand, reserved: stockPositions.reserved })
        .from(stockPositions)
        .where(eq(stockPositions.id, stockPositionId));
      return row!;
    };
    const before = await readStock();

    const complete = (key: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/internal/sales/${saleId}/complete`,
        headers: {
          authorization: `Bearer ${internalJwt('sales-internal-secret', organizationId)}`,
          'idempotency-key': key,
        },
        payload: { completionReferenceType: 'PAYMENT', completionReferenceId: 'pay-conc-1' },
      });

    const [a, b] = await Promise.allSettled([complete(newId()), complete(newId())]);
    const responses = [a, b].map((result) =>
      result.status === 'fulfilled' ? result.value : result.reason,
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(201);
      expect(response.json().data).toMatchObject({ id: saleId, status: 'COMPLETED' });
    }

    const [reservation] = await testdb.db
      .select({ status: reservations.status })
      .from(reservations)
      .where(eq(reservations.id, reservationId));
    expect(reservation?.status).toBe('CONSUMED');

    const after = await readStock();
    expect(after.onHand).toBe(subDecimal(before.onHand, '2.00000000'));
    expect(after.reserved).toBe(subDecimal(before.reserved, '2.00000000'));
  });

  it('releases a reservation exactly once when cancel is replayed concurrently', async () => {
    const { saleId, reservationId } = await createPendingSale('1.00000000');
    const readStock = async () => {
      const [row] = await testdb.db
        .select({ onHand: stockPositions.onHand, reserved: stockPositions.reserved })
        .from(stockPositions)
        .where(eq(stockPositions.id, stockPositionId));
      return row!;
    };
    const before = await readStock();

    const cancel = (key: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/pos/sales/${saleId}/cancel`,
        headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': key },
        payload: { reason: 'double-cancel race' },
      });

    const [a, b] = await Promise.allSettled([cancel(newId()), cancel(newId())]);
    const responses = [a, b].map((result) =>
      result.status === 'fulfilled' ? result.value : result.reason,
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(201);
      expect(response.json().data).toMatchObject({ id: saleId, status: 'CANCELLED' });
    }

    const [reservation] = await testdb.db
      .select({ status: reservations.status })
      .from(reservations)
      .where(eq(reservations.id, reservationId));
    expect(reservation?.status).toBe('RELEASED');

    const after = await readStock();
    expect(after.onHand).toBe(before.onHand);
    expect(after.reserved).toBe(subDecimal(before.reserved, '1.00000000'));
  });

  it('cancel vs complete race yields exactly one terminal state and no double stock effect', async () => {
    const { saleId, reservationId } = await createPendingSale('1.00000000');
    const readStock = async () => {
      const [row] = await testdb.db
        .select({ onHand: stockPositions.onHand, reserved: stockPositions.reserved })
        .from(stockPositions)
        .where(eq(stockPositions.id, stockPositionId));
      return row!;
    };
    const before = await readStock();

    const cancel = () =>
      app.inject({
        method: 'POST',
        url: `/api/v1/pos/sales/${saleId}/cancel`,
        headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': newId() },
        payload: { reason: 'cancel-vs-complete race' },
      });
    const complete = () =>
      app.inject({
        method: 'POST',
        url: `/api/v1/internal/sales/${saleId}/complete`,
        headers: {
          authorization: `Bearer ${internalJwt('sales-internal-secret', organizationId)}`,
          'idempotency-key': newId(),
        },
        payload: { completionReferenceType: 'PAYMENT', completionReferenceId: 'pay-conc-2' },
      });

    const [a, b] = await Promise.allSettled([cancel(), complete()]);
    const responses = [a, b].map((result) =>
      result.status === 'fulfilled' ? result.value : result.reason,
    );
    const statusCodes = responses.map((response) => response.statusCode).sort();
    // One operation wins; the loser sees the mutually-exclusive terminal state (SALE_INVALID_STATE).
    expect(statusCodes).toEqual([201, 409]);

    const winner = responses.find((response) => response.statusCode === 201).json().data;
    expect(['CANCELLED', 'COMPLETED']).toContain(winner.status);

    const [reservation] = await testdb.db
      .select({ status: reservations.status })
      .from(reservations)
      .where(eq(reservations.id, reservationId));
    const after = await readStock();

    if (winner.status === 'CANCELLED') {
      expect(reservation?.status).toBe('RELEASED');
      expect(after.onHand).toBe(before.onHand);
      expect(after.reserved).toBe(subDecimal(before.reserved, '1.00000000'));
    } else {
      expect(reservation?.status).toBe('CONSUMED');
      expect(after.onHand).toBe(subDecimal(before.onHand, '1.00000000'));
      expect(after.reserved).toBe(subDecimal(before.reserved, '1.00000000'));
    }
  });

  async function createPendingSale(quantity: string): Promise<{
    saleId: string;
    reservationId: string;
  }> {
    const cartId = newId();
    await testdb.db.insert(carts).values({
      id: cartId,
      organizationId,
      branchId,
      channel: 'POS',
      status: 'DRAFT',
      customerId: null,
    });
    await testdb.db.insert(cartItems).values({
      id: newId(),
      organizationId,
      cartId,
      variantId,
      unitId,
      quantity,
    });
    const checkout = await app.inject({
      method: 'POST',
      url: '/api/v1/pos/sales',
      headers: {
        authorization: `Bearer ${bearer}`,
        'idempotency-key': newId(),
        'if-match': '1',
      },
      payload: { cartId, warehouseId, priceType: 'CASH' },
    });
    expect(checkout.statusCode).toBe(201);
    const data = checkout.json().data;
    return { saleId: data.id as string, reservationId: data.inventoryReservationId as string };
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

function jwt(subject: string, audience: string | string[] = 'tenant-api'): string {
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
  return `${input}.${createHmac('sha256', process.env.SUPABASE_JWT_SECRET!).update(input).digest('base64url')}`;
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

function subDecimal(minuend: string, subtrahend: string): string {
  const scale = 100000000n;
  const m = toScaled(minuend);
  const s = toScaled(subtrahend);
  const diff = m - s;
  return `${diff / scale}.${(diff % scale).toString().padStart(8, '0')}`;
}

function toScaled(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole || '0') * 100000000n + BigInt(fraction.padEnd(8, '0').slice(0, 8));
}
