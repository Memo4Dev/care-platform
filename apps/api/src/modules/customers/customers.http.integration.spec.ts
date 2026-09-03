import { createHmac } from 'node:crypto';
import {
  branchAccess,
  newId,
  planEntitlements,
  plans,
  platformTenants,
  subscriptions,
  users,
} from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../main';
import { DATABASE } from '../database/database.tokens';
import { IdentityProvisioningService } from '../identity/application/identity-provisioning.service';
import { RoleRepository } from '../identity/infrastructure/role.repository';
import { UserRepository } from '../identity/infrastructure/user.repository';
import { OrganizationService } from '../organization/application/organization.service';
import { OrganizationRepository } from '../organization/infrastructure/organization.repository';

describe('Customers HTTP boundary', () => {
  let testdb: TestDatabase;
  let app: NestFastifyApplication;
  let ownerBearer: string;
  let deniedBearer: string;
  let foreignOwnerBearer: string;
  let customerId: string;
  let foreignCustomerId: string;
  let originalDatabaseUrl: string | undefined;

  async function activateTenant(organizationId: string, planCode: string) {
    const now = new Date();
    const planId = newId();
    await testdb.db.insert(plans).values({
      id: planId,
      code: planCode,
      name: `${planCode} Plan`,
      status: 'ACTIVE',
    });
    await testdb.db.insert(planEntitlements).values([
      { planId, code: 'branches.max', valueJson: 10 },
      { planId, code: 'warehouses.max', valueJson: 10 },
    ]);
    await testdb.db.insert(subscriptions).values({
      id: newId(),
      organizationId,
      planId,
      status: 'ACTIVE',
      billingCycle: 'MONTHLY',
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 60_000),
    });
    await testdb.db.insert(platformTenants).values({
      id: newId(),
      organizationId,
      status: 'ACTIVE',
      provisioningStatus: 'COMPLETED',
    });
  }

  beforeAll(async () => {
    testdb = await createTestDatabase();
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testdb.uri;
    process.env.SUPABASE_JWT_SECRET = 'customers-http-test-secret';
    process.env.SUPABASE_JWT_ISSUER = 'https://auth.example.test';
    process.env.SUPABASE_PLATFORM_AUDIENCE = 'platform-api';
    process.env.SUPABASE_TENANT_AUDIENCE = 'tenant-api';

    const organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    const identityProvisioning = new IdentityProvisioningService(
      testdb.db,
      new UserRepository(),
      new RoleRepository(),
    );

    const tenant = await organizations.createOrganization({ name: 'Customers HTTP Org A' });
    const tenantBranchId = newId();
    await organizations.createBranch({
      organizationId: tenant.organization.id,
      branchId: tenantBranchId,
      code: 'CUST-A',
      name: 'Customers HTTP Branch A',
    });
    const owner = await identityProvisioning.provisionInitialOwner({
      organizationId: tenant.organization.id,
      email: 'customers-http-owner@example.test',
      name: 'Customers HTTP Owner',
      supabaseUserId: 'customers-http-owner',
      correlationId: newId(),
      causationId: newId(),
    });
    await testdb.db.insert(branchAccess).values({
      organizationId: tenant.organization.id,
      branchId: tenantBranchId,
      userId: owner.user.id,
    });
    const deniedUserId = newId();
    await testdb.db.insert(users).values({
      id: deniedUserId,
      organizationId: tenant.organization.id,
      supabaseUserId: 'customers-http-denied',
      email: 'customers-http-denied@example.test',
      name: 'Customers HTTP Denied',
    });
    await testdb.db.insert(branchAccess).values({
      organizationId: tenant.organization.id,
      branchId: tenantBranchId,
      userId: deniedUserId,
    });
    await activateTenant(tenant.organization.id, 'CUSTOMERS_HTTP_A');

    const foreignTenant = await organizations.createOrganization({ name: 'Customers HTTP Org B' });
    const foreignBranchId = newId();
    await organizations.createBranch({
      organizationId: foreignTenant.organization.id,
      branchId: foreignBranchId,
      code: 'CUST-B',
      name: 'Customers HTTP Branch B',
    });
    const foreignOwner = await identityProvisioning.provisionInitialOwner({
      organizationId: foreignTenant.organization.id,
      email: 'customers-http-foreign-owner@example.test',
      name: 'Customers HTTP Foreign Owner',
      supabaseUserId: 'customers-http-foreign-owner',
      correlationId: newId(),
      causationId: newId(),
    });
    await testdb.db.insert(branchAccess).values({
      organizationId: foreignTenant.organization.id,
      branchId: foreignBranchId,
      userId: foreignOwner.user.id,
    });
    await activateTenant(foreignTenant.organization.id, 'CUSTOMERS_HTTP_B');

    ownerBearer = jwt('customers-http-owner', 'tenant-api');
    deniedBearer = jwt('customers-http-denied', 'tenant-api');
    foreignOwnerBearer = jwt('customers-http-foreign-owner', 'tenant-api');

    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await app?.get(DATABASE).$client.end();
    process.env.DATABASE_URL = originalDatabaseUrl;
    await testdb?.teardown();
  });

  it('rejects missing and malformed JWTs with the standard 401 error envelope', async () => {
    const missing = await app.inject({ method: 'GET', url: '/api/v1/admin/customers/search' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({
      error: {
        code: 'AUTHENTICATION_REQUIRED',
        message: expect.any(String),
        correlationId: expect.any(String),
      },
    });

    const invalid = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/customers/search',
      headers: { authorization: 'Bearer not-a-valid-jwt' },
    });
    expect(invalid.statusCode).toBe(401);
    expect(invalid.json()).toMatchObject({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: expect.any(String),
        correlationId: expect.any(String),
      },
    });
  });

  it('denies a tenant user without sales.create', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers',
      headers: { authorization: `Bearer ${deniedBearer}`, 'idempotency-key': newId() },
      payload: { type: 'INDIVIDUAL', displayName: 'Denied Customer' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: 'PERMISSION_DENIED',
        message: expect.any(String),
        correlationId: expect.any(String),
      },
    });
  });

  it('rejects an invalid customer body and invalid search limit with 422 envelopes', async () => {
    const invalidBody = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { type: 'INDIVIDUAL', displayName: '', unexpected: true },
    });
    expect(invalidBody.statusCode).toBe(422);
    expect(invalidBody.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: expect.any(String),
        correlationId: expect.any(String),
      },
    });

    const invalidLimit = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/customers/search?limit=101',
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(invalidLimit.statusCode).toBe(422);
    expect(invalidLimit.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: expect.any(String),
        correlationId: expect.any(String),
      },
    });
  });

  it('requires an Idempotency-Key for customer creation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers',
      headers: { authorization: `Bearer ${ownerBearer}` },
      payload: { type: 'INDIVIDUAL', displayName: 'Missing Key' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: expect.any(String),
        correlationId: expect.any(String),
      },
    });
  });

  it('rejects an overlong Idempotency-Key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers',
      headers: {
        authorization: `Bearer ${ownerBearer}`,
        'idempotency-key': 'k'.repeat(256),
      },
      payload: { type: 'INDIVIDUAL', displayName: 'Overlong Key' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', correlationId: expect.any(String) },
    });
  });

  it('creates, gets, and searches a customer through the HTTP boundary', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: {
        type: 'BUSINESS',
        displayName: 'Acme Customer',
        code: 'ACME-001',
        phone: '+201000000000',
        email: 'sales@acme.example.test',
      },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({
      data: {
        id: expect.any(String),
        type: 'BUSINESS',
        displayName: 'Acme Customer',
        code: 'ACME-001',
      },
    });
    expect(create.json().data).not.toHaveProperty('phone');
    expect(create.json().data).not.toHaveProperty('email');
    customerId = create.json().data.id;

    const get = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/customers/${customerId}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({ data: { id: customerId, displayName: 'Acme Customer' } });

    const search = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/customers/search?q=Acme&limit=10',
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({
      data: [expect.objectContaining({ id: customerId, displayName: 'Acme Customer' })],
    });
  });

  it('masks a foreign customer IDOR as not found', async () => {
    const foreignCreate = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers',
      headers: { authorization: `Bearer ${foreignOwnerBearer}`, 'idempotency-key': newId() },
      payload: { type: 'INDIVIDUAL', displayName: 'Foreign Customer' },
    });
    expect(foreignCreate.statusCode).toBe(201);
    foreignCustomerId = foreignCreate.json().data.id;

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/customers/${foreignCustomerId}`,
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: expect.any(String),
        correlationId: expect.any(String),
      },
    });
  });

  it('rejects a malformed customer ID at the HTTP boundary', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/customers/not-a-uuid',
      headers: { authorization: `Bearer ${ownerBearer}` },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        correlationId: expect.any(String),
      },
    });
  });

  it('exactly replays a completed customer create outcome', async () => {
    const key = newId();
    const request = {
      method: 'POST' as const,
      url: '/api/v1/admin/customers',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': key },
      payload: { type: 'BUSINESS', displayName: 'Replay Customer', code: 'REPLAY-001' },
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.body).toBe(first.body);
  });

  it('rejects a different customer payload under a previously used Idempotency-Key', async () => {
    const key = newId();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': key },
      payload: { type: 'INDIVIDUAL', displayName: 'Original Customer' },
    });
    expect(first.statusCode).toBe(201);

    const conflict = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/customers',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': key },
      payload: { type: 'BUSINESS', displayName: 'Conflicting Customer' },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      error: {
        code: 'IDEMPOTENCY_CONFLICT',
        message: expect.any(String),
        correlationId: expect.any(String),
      },
    });
  });
});

function jwt(subject: string, audience: string) {
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
