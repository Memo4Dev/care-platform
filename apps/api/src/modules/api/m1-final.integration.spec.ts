import { createHmac } from 'node:crypto';
import {
  newId,
  planEntitlements,
  plans,
  platformCapabilities,
  platformPrincipalRoles,
  platformPrincipals,
  platformRoleCapabilities,
  platformRoles,
  platformTenants,
  subscriptions,
} from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../main';
import { DATABASE } from '../database/database.tokens';
import { OrganizationService } from '../organization/application/organization.service';
import { OrganizationRepository } from '../organization/infrastructure/organization.repository';
import { TenantProvisioningService } from '../provisioning/application/tenant-provisioning.service';
import { UnavailablePlatformRegistrationResolver } from '../platform/application/platform-registration.contract';
import { IdentityProvisioningService } from '../identity/application/identity-provisioning.service';

/** Native-PostgreSQL milestone exit flow; Redis delivery remains CI-gated. */
describe('M1-010 final integration and isolation suite', () => {
  let testdb: TestDatabase;
  let app: NestFastifyApplication;
  let ownerBearer: string;
  let operatorBearer: string;
  let tenantId: string;
  let organizationId: string;
  let defaultBranchId: string;
  let originalDatabaseUrl: string | undefined;
  let registrationResolverSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    testdb = await createTestDatabase();
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testdb.uri;
    process.env.SUPABASE_JWT_SECRET = 'm1-010-test-secret';
    process.env.SUPABASE_JWT_ISSUER = 'https://auth.example.test';
    process.env.SUPABASE_PLATFORM_AUDIENCE = 'platform-api';
    process.env.SUPABASE_TENANT_AUDIENCE = 'tenant-api';

    const operatorId = newId();
    const roleId = newId();
    await testdb.db.insert(platformPrincipals).values({
      id: operatorId,
      supabaseUserId: 'm1-010-operator',
    });
    await testdb.db
      .insert(platformRoles)
      .values({ id: roleId, code: 'M1_010', name: 'M1 operator' });
    await testdb.db
      .insert(platformCapabilities)
      .values({ id: newId(), code: 'tenant.suspend', description: 'M1 lifecycle operator' })
      .onConflictDoNothing();
    const [capability] = await testdb.db
      .select()
      .from(platformCapabilities)
      .where(eq(platformCapabilities.code, 'tenant.suspend'));
    await testdb.db.insert(platformPrincipalRoles).values({ principalId: operatorId, roleId });
    await testdb.db
      .insert(platformRoleCapabilities)
      .values({ roleId, capabilityId: capability!.id });
    operatorBearer = jwt('m1-010-operator', 'platform-api');

    const organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    const organization = await organizations.createOrganization({ name: 'M1 final tenant' });
    organizationId = organization.organization.id;
    tenantId = newId();
    const planId = newId();
    const subscriptionId = newId();
    const registrationReference = `m1-010-${newId()}`;
    await testdb.db
      .insert(plans)
      .values({ id: planId, code: 'M1_010', name: 'M1 final', status: 'ACTIVE' });
    await testdb.db.insert(planEntitlements).values([
      { planId, code: 'branches.max', valueJson: 1 },
      { planId, code: 'warehouses.max', valueJson: 1 },
      { planId, code: 'storefront.enabled', valueJson: false },
    ]);
    const now = new Date();
    await testdb.db.insert(subscriptions).values({
      id: subscriptionId,
      organizationId,
      planId,
      status: 'ACTIVE',
      billingCycle: 'MONTHLY',
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 86_400_000),
    });
    registrationResolverSpy = vi
      .spyOn(UnavailablePlatformRegistrationResolver.prototype, 'resolveTrustedRegistration')
      .mockImplementation(async () => {
        return {
          reference: registrationReference,
          organizationId,
          requestedOrganizationName: 'M1 final tenant',
          owner: {
            supabaseSubject: 'm1-010-owner',
            email: 'm1-010-owner@example.test',
            displayName: 'M1 Owner',
          },
          verifiedAt: new Date(),
        } as never;
      });

    app = await createApp();
    await app.init();
    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/tenants',
      headers: { authorization: `Bearer ${operatorBearer}`, 'idempotency-key': newId() },
      payload: { registrationReference },
    });
    expect(registration.statusCode).toBe(201);
    tenantId = registration.json().data.tenant.id;
    const [registeredTenant] = await testdb.db
      .select()
      .from(platformTenants)
      .where(eq(platformTenants.id, tenantId));
    expect(registeredTenant).toMatchObject({
      organizationId,
      registrationReference,
      registrationStatus: 'VERIFIED',
    });
    await app.get(TenantProvisioningService).start({
      registrationReference,
      correlationId: newId(),
      causationId: newId(),
    });
    defaultBranchId = (
      await testdb.client.query<{ id: string }>(
        'SELECT id FROM organization.branches WHERE organization_id = $1',
        [organizationId],
      )
    ).rows[0]!.id;
    ownerBearer = jwt('m1-010-owner', 'tenant-api');
  });

  afterAll(async () => {
    registrationResolverSpy?.mockRestore();
    await app?.close();
    await app?.get(DATABASE).$client.end();
    process.env.DATABASE_URL = originalDatabaseUrl;
    await testdb?.teardown();
  });

  it('M1 E2E provisions a single Owner/default branch/default warehouse, activates, and permits owner login', async () => {
    const activation = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/activate`,
      headers: { authorization: `Bearer ${operatorBearer}`, 'idempotency-key': newId() },
    });
    expect(activation.statusCode).toBe(201);

    const branches = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/organization/branches',
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    const warehouses = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/organization/warehouses',
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(branches.statusCode).toBe(200);
    expect(branches.json().data).toEqual([expect.objectContaining({ id: defaultBranchId })]);
    expect(warehouses.statusCode).toBe(200);
    expect(warehouses.json().data).toEqual([
      expect.objectContaining({ branchId: defaultBranchId, code: 'DEFAULT' }),
    ]);
  });

  it('SUB-002 rejects an excess branch before persistence', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/organization/branches',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { code: 'OVER-LIMIT', name: 'Over limit' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'PLAN_LIMIT_REACHED' } });
  });

  it('SUB-002 serializes concurrent different-key branch creates at branches.max=1', async () => {
    const concurrentOrganizationId = newId();
    const concurrentPlanId = newId();
    const concurrentTenantId = newId();
    const concurrentOwnerSubject = `m1-010-concurrent-owner-${newId()}`;
    const now = new Date();
    await testdb.client.query('INSERT INTO organization.organizations (id, name) VALUES ($1, $2)', [
      concurrentOrganizationId,
      'Concurrent plan-limit tenant',
    ]);
    await testdb.db.insert(plans).values({
      id: concurrentPlanId,
      code: `M1_010_CONCURRENT_${newId()}`,
      name: 'Concurrent limit plan',
      status: 'ACTIVE',
    });
    await testdb.db.insert(planEntitlements).values({
      planId: concurrentPlanId,
      code: 'branches.max',
      valueJson: 1,
    });
    await testdb.db.insert(subscriptions).values({
      id: newId(),
      organizationId: concurrentOrganizationId,
      planId: concurrentPlanId,
      status: 'ACTIVE',
      billingCycle: 'MONTHLY',
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 86_400_000),
    });
    await testdb.db.insert(platformTenants).values({
      id: concurrentTenantId,
      organizationId: concurrentOrganizationId,
      status: 'ACTIVE',
      provisioningStatus: 'COMPLETED',
    });
    await app.get(IdentityProvisioningService).provisionInitialOwner({
      organizationId: concurrentOrganizationId,
      email: `m1-010-concurrent-${newId()}@example.test`,
      name: 'Concurrent Owner',
      supabaseUserId: concurrentOwnerSubject,
      correlationId: newId(),
      causationId: newId(),
    });
    const concurrentBearer = jwt(concurrentOwnerSubject, 'tenant-api');
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/api/v1/admin/organization/branches',
        headers: { authorization: `Bearer ${concurrentBearer}`, 'idempotency-key': newId() },
        payload: { code: 'CONCURRENT-A', name: 'Concurrent A' },
      }),
      app.inject({
        method: 'POST',
        url: '/api/v1/admin/organization/branches',
        headers: { authorization: `Bearer ${concurrentBearer}`, 'idempotency-key': newId() },
        payload: { code: 'CONCURRENT-B', name: 'Concurrent B' },
      }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 403]);
    expect([first, second].find((response) => response.statusCode === 403)?.json()).toMatchObject({
      error: { code: 'PLAN_LIMIT_REACHED' },
    });
    const count = await testdb.client.query<{ count: string }>(
      'SELECT count(*) FROM organization.branches WHERE organization_id = $1',
      [concurrentOrganizationId],
    );
    expect(count.rows[0]).toEqual({ count: '1' });
  });

  it('TEN-002 masks a foreign branch injection and TEN-003 rejects a direct tenant FK injection', async () => {
    const organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    const other = await organizations.createOrganization({ name: 'M1 foreign tenant' });
    const foreignBranchId = newId();
    await organizations.createBranch({
      organizationId: other.organization.id,
      branchId: foreignBranchId,
      code: 'FOREIGN',
      name: 'Foreign branch',
    });
    const injected = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/organization/warehouses',
      headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      payload: { branchId: foreignBranchId, code: 'INJECT', name: 'Injected warehouse' },
    });
    expect(injected.statusCode).toBe(404);
    expect(injected.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } });
    await expect(
      testdb.client.query(
        `INSERT INTO organization.warehouses (id, organization_id, branch_id, code, name)
         VALUES ($1, $2, $3, $4, $5)`,
        [newId(), organizationId, foreignBranchId, 'RAW-INJECT', 'Raw injection'],
      ),
    ).rejects.toMatchObject({ code: '23503', constraint: 'warehouses_branch_tenant_fk' });
  });

  it('suspension blocks the previously authenticated Owner (M1 subscription/business-access behavior)', async () => {
    const suspended = await app.inject({
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/suspend`,
      headers: { authorization: `Bearer ${operatorBearer}`, 'idempotency-key': newId() },
      payload: { reason: 'M1 final suspension check' },
    });
    expect(suspended.statusCode).toBe(201);
    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/organization/branches',
      headers: { authorization: `Bearer ${ownerBearer}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'TENANT_SUSPENDED' } });
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
