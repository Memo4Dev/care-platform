import { createHash, createHmac } from 'node:crypto';
import {
  integrationOutbox,
  idempotencyOutcomes,
  branchAccess,
  branches,
  newId,
  organizations,
  planEntitlements,
  plans,
  platformCapabilities,
  platformPrincipalRoles,
  platformPrincipals,
  platformRoleCapabilities,
  platformRoles,
  platformTenants,
  provisioningRetryRequests,
  subscriptions,
  users,
  warehouses,
} from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../main';
import { DATABASE } from '../database/database.tokens';
import { IdentityProvisioningService } from '../identity/application/identity-provisioning.service';
import { RoleRepository } from '../identity/infrastructure/role.repository';
import { UserRepository } from '../identity/infrastructure/user.repository';
import { OrganizationService } from '../organization/application/organization.service';
import { OrganizationRepository } from '../organization/infrastructure/organization.repository';

describe('M1-009 authenticated Platform API', () => {
  let testdb: TestDatabase;
  let app: NestFastifyApplication;
  let bearer: string;
  let unauthorizedBearer: string;
  let tenantBearer: string;
  let deniedTenantBearer: string;
  let unlinkedTenantBearer: string;
  let tenantBranchId: string;
  let unscopedTenantBranchId: string;
  let foreignTenantBranchId: string;
  let tenantOrganizationId: string;
  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    testdb = await createTestDatabase();
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testdb.uri;
    process.env.SUPABASE_JWT_SECRET = 'm1-009-test-secret';
    process.env.SUPABASE_JWT_ISSUER = 'https://auth.example.test';
    process.env.SUPABASE_PLATFORM_AUDIENCE = 'platform-api';
    process.env.SUPABASE_TENANT_AUDIENCE = 'tenant-api';

    const principalId = newId();
    const roleId = newId();
    await testdb.db.insert(platformPrincipals).values({
      id: principalId,
      supabaseUserId: 'platform-subject',
    });
    await testdb.db
      .insert(platformRoles)
      .values({ id: roleId, code: 'TEST_OPERATOR', name: 'Test' });
    await testdb.db
      .insert(platformCapabilities)
      .values([
        { id: newId(), code: 'entitlement.override', description: 'Test capability' },
        { id: newId(), code: 'tenant.suspend', description: 'Retry capability' },
      ])
      .onConflictDoNothing();
    const capabilities = await testdb.db
      .select({ id: platformCapabilities.id })
      .from(platformCapabilities);
    await testdb.db.insert(platformPrincipalRoles).values({ principalId, roleId });
    await testdb.db
      .insert(platformRoleCapabilities)
      .values(
        capabilities
          .filter((capability) => capability.id)
          .map((capability) => ({ roleId, capabilityId: capability.id })),
      );
    await testdb.db.insert(platformPrincipals).values({
      id: newId(),
      supabaseUserId: 'no-capability-subject',
    });
    bearer = jwt('platform-subject', 'platform-api');
    unauthorizedBearer = jwt('no-capability-subject', 'platform-api');

    const organizationsService = new OrganizationService(testdb.db, new OrganizationRepository());
    const identityProvisioning = new IdentityProvisioningService(
      testdb.db,
      new UserRepository(),
      new RoleRepository(),
    );
    const tenant = await organizationsService.createOrganization({ name: 'Tenant HTTP matrix A' });
    tenantOrganizationId = tenant.organization.id;
    tenantBranchId = newId();
    unscopedTenantBranchId = newId();
    await organizationsService.createBranch({
      organizationId: tenantOrganizationId,
      branchId: tenantBranchId,
      code: 'HTTP-A',
      name: 'Authorized tenant branch',
    });
    await organizationsService.createBranch({
      organizationId: tenantOrganizationId,
      branchId: unscopedTenantBranchId,
      code: 'HTTP-NO-SCOPE',
      name: 'Tenant branch outside subject scope',
    });
    const foreignTenant = await organizationsService.createOrganization({
      name: 'Tenant HTTP matrix B',
    });
    foreignTenantBranchId = newId();
    await organizationsService.createBranch({
      organizationId: foreignTenant.organization.id,
      branchId: foreignTenantBranchId,
      code: 'HTTP-B',
      name: 'Foreign tenant branch',
    });
    const owner = await identityProvisioning.provisionInitialOwner({
      organizationId: tenantOrganizationId,
      email: 'tenant-http-owner@example.test',
      name: 'Tenant HTTP Owner',
      supabaseUserId: 'tenant-http-owner',
      correlationId: newId(),
      causationId: newId(),
    });
    await testdb.db.insert(branchAccess).values({
      organizationId: tenantOrganizationId,
      branchId: tenantBranchId,
      userId: owner.user.id,
    });
    await testdb.db.insert(users).values({
      id: newId(),
      organizationId: tenantOrganizationId,
      supabaseUserId: 'tenant-http-denied',
      email: 'tenant-http-denied@example.test',
      name: 'Tenant HTTP Denied',
    });
    const tenantPlanId = newId();
    const now = new Date();
    await testdb.db.insert(plans).values({
      id: tenantPlanId,
      code: 'TENANT_HTTP_MATRIX',
      name: 'Tenant HTTP Matrix',
      status: 'ACTIVE',
    });
    await testdb.db.insert(planEntitlements).values([
      { planId: tenantPlanId, code: 'branches.max', valueJson: 10 },
      { planId: tenantPlanId, code: 'warehouses.max', valueJson: 10 },
    ]);
    await testdb.db.insert(subscriptions).values({
      id: newId(),
      organizationId: tenantOrganizationId,
      planId: tenantPlanId,
      status: 'ACTIVE',
      billingCycle: 'MONTHLY',
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 60_000),
    });
    await testdb.db.insert(platformTenants).values({
      id: newId(),
      organizationId: tenantOrganizationId,
      status: 'ACTIVE',
      provisioningStatus: 'COMPLETED',
    });
    const unlinkedOrganization = await organizationsService.createOrganization({
      name: 'Unlinked tenant principal',
    });
    await testdb.db.insert(users).values({
      id: newId(),
      organizationId: unlinkedOrganization.organization.id,
      supabaseUserId: 'unlinked-tenant-user',
      email: 'unlinked-tenant-user@example.test',
      name: 'Unlinked Tenant User',
    });
    tenantBearer = jwt('tenant-http-owner', 'tenant-api');
    deniedTenantBearer = jwt('tenant-http-denied', 'tenant-api');
    unlinkedTenantBearer = jwt('unlinked-tenant-user', 'tenant-api');

    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await app?.get(DATABASE).$client.end();
    process.env.DATABASE_URL = originalDatabaseUrl;
    await testdb?.teardown();
  });

  it('rejects missing or audience-invalid bearer credentials before the mutation', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/v1/platform/plans' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });

    const wrongAudience = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/plans',
      headers: { authorization: `Bearer ${jwt('platform-subject', 'tenant-api')}` },
    });
    expect(wrongAudience.statusCode).toBe(401);
    expect(wrongAudience.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
  });

  it('rejects an authenticated platform user without the mutation capability', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/plans',
      headers: { authorization: `Bearer ${unauthorizedBearer}`, 'idempotency-key': newId() },
      payload: { code: 'NO_CAPABILITY', name: 'Denied plan' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
  });

  it('atomically replays and rejects conflicting Plan mutations', async () => {
    const key = newId();
    const request = {
      method: 'POST',
      url: '/api/v1/platform/plans',
      headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': key },
      payload: { code: 'M1_009', name: 'M1 API plan' },
    } as const;
    const response = await app.inject(request);
    const replay = await app.inject(request);
    const conflict = await app.inject({
      ...request,
      payload: { code: 'M1_009', name: 'Changed plan' },
    });

    expect(response.statusCode).toBe(201);
    expect(replay.json()).toEqual(response.json());
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(response.json()).toMatchObject({
      data: { plan: { code: 'M1_009', name: 'M1 API plan' } },
    });
    expect(await testdb.db.$count(plans, eq(plans.code, 'M1_009'))).toBe(1);
  });

  it('requires a key for Platform Admin mutations', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/plans',
      headers: { authorization: `Bearer ${bearer}` },
      payload: { code: 'CONFLICT_A', name: 'First plan' },
    });
    expect(first.statusCode).toBe(422);
    expect(first.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });
  it('fails closed when a Platform Admin key has a durable in-progress claim', async () => {
    const key = newId();
    const payload = { code: 'IN_PROGRESS', name: 'Pending plan' };
    await testdb.db.insert(idempotencyOutcomes).values({
      id: newId(),
      scope: 'PLATFORM_USER:platform-subject:POST:/api/v1/platform/plans',
      idempotencyKey: key,
      requestHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      status: 'IN_PROGRESS',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/plans',
      headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': key },
      payload,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(await testdb.db.$count(plans, eq(plans.code, payload.code))).toBe(0);
  });
  it('keeps tenant lifecycle, subscription, and override command outcomes with their outbox effects', async () => {
    const organizationId = newId();
    const tenantId = newId();
    const now = new Date();
    await testdb.db
      .insert(organizations)
      .values({ id: organizationId, name: 'Atomic platform tenant' });
    await testdb.db.insert(platformTenants).values({ id: tenantId, organizationId });

    const suspend = {
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/suspend`,
      headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': newId() },
      payload: { reason: 'Operator review' },
    } as const;
    const suspended = await app.inject(suspend);
    const suspendReplay = await app.inject(suspend);
    const suspendConflict = await app.inject({ ...suspend, payload: { reason: 'Changed reason' } });
    expect(suspended.statusCode).toBe(201);
    expect(suspendReplay.json()).toEqual(suspended.json());
    expect(suspendConflict.statusCode).toBe(409);

    const currentPlanId = newId();
    const replacementPlanId = newId();
    const subscriptionId = newId();
    await testdb.db.insert(plans).values([
      { id: currentPlanId, code: `CURRENT_${newId()}`, name: 'Current', status: 'ACTIVE' },
      {
        id: replacementPlanId,
        code: `REPLACEMENT_${newId()}`,
        name: 'Replacement',
        status: 'ACTIVE',
      },
    ]);
    await testdb.db.insert(subscriptions).values({
      id: subscriptionId,
      organizationId,
      planId: currentPlanId,
      status: 'ACTIVE',
      billingCycle: 'MONTHLY',
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 86_400_000),
    });
    const changePlan = {
      method: 'POST',
      url: `/api/v1/platform/subscriptions/${subscriptionId}/change-plan`,
      headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': newId() },
      payload: { planId: replacementPlanId, effectiveAt: now.toISOString() },
    } as const;
    const changed = await app.inject(changePlan);
    expect(changed.statusCode).toBe(201);
    expect((await app.inject(changePlan)).json()).toEqual(changed.json());
    expect(
      (
        await app.inject({
          ...changePlan,
          payload: {
            ...changePlan.payload,
            effectiveAt: new Date(now.getTime() + 1_000).toISOString(),
          },
        })
      ).statusCode,
    ).toBe(409);

    const grant = {
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/entitlement-overrides`,
      headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': newId() },
      payload: {
        code: 'storefront.enabled',
        value: true,
        effectiveFrom: now.toISOString(),
        reason: 'Temporary operator approval',
      },
    } as const;
    const granted = await app.inject(grant);
    expect(granted.statusCode).toBe(201);
    expect((await app.inject(grant)).json()).toEqual(granted.json());
    expect(
      (await app.inject({ ...grant, payload: { ...grant.payload, reason: 'Changed' } })).statusCode,
    ).toBe(409);
    expect(await testdb.db.$count(integrationOutbox)).toBeGreaterThan(3);
  });
  it('accepts retry as one durable outbox/idempotency transaction and deduplicates active work', async () => {
    const organizationId = newId();
    const tenantId = newId();
    const registrationReference = `verified-${newId()}`;
    await testdb.db.insert(organizations).values({ id: organizationId, name: 'Retry tenant' });
    await testdb.db.insert(platformTenants).values({
      id: tenantId,
      organizationId,
      registrationReference,
      registrationStatus: 'VERIFIED',
      registrationRequestedOrganizationName: 'Retry tenant',
      registrationOwnerSupabaseSubject: `owner-${newId()}`,
      registrationOwnerEmail: `owner-${newId()}@example.test`,
      registrationOwnerDisplayName: 'Owner',
    });
    const firstKey = newId();
    const request = {
      method: 'POST',
      url: `/api/v1/platform/tenants/${tenantId}/provisioning/retry`,
      headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': firstKey },
      payload: { registrationReference },
    } as const;
    const first = await app.inject(request);
    const replay = await app.inject(request);
    const activeDedupe = await app.inject({
      ...request,
      headers: { ...request.headers, 'idempotency-key': newId() },
    });
    expect(first.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(activeDedupe.json()).toMatchObject({ data: { deduplicated: true } });
    expect(await testdb.db.$count(provisioningRetryRequests)).toBe(1);
    expect(
      await testdb.db.$count(
        integrationOutbox,
        eq(integrationOutbox.eventType, 'provisioning.provisioning-retry-requested'),
      ),
    ).toBe(1);
    const conflicting = await app.inject({
      ...request,
      payload: { registrationReference: `different-${newId()}` },
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('enforces the tenant branch HTTP authentication, authorization, isolation and idempotency matrix', async () => {
    const url = '/api/v1/admin/organization/branches';
    const missing = await app.inject({ method: 'GET', url });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });

    const wrongAudience = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${jwt('tenant-http-owner', 'platform-api')}` },
    });
    expect(wrongAudience.statusCode).toBe(401);
    expect(wrongAudience.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });

    const denied = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${deniedTenantBearer}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });

    const listed = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${tenantBearer}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: tenantBranchId })]),
    );
    expect(listed.json().data.map((branch: { id: string }) => branch.id)).not.toContain(
      foreignTenantBranchId,
    );
    expect(listed.json().data.map((branch: { id: string }) => branch.id)).not.toContain(
      unscopedTenantBranchId,
    );

    const missingKey = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${tenantBearer}` },
      payload: { code: 'HTTP-CREATED', name: 'Created through HTTP' },
    });
    expect(missingKey.statusCode).toBe(422);
    expect(missingKey.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const key = newId();
    const request = {
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${tenantBearer}`, 'idempotency-key': key },
      payload: { code: 'HTTP-CREATED', name: 'Created through HTTP', priority: 2 },
    } as const;
    const created = await app.inject(request);
    const replay = await app.inject(request);
    const conflict = await app.inject({
      ...request,
      payload: { ...request.payload, name: 'Changed' },
    });
    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(
      await testdb.db.$count(branches, eq(branches.organizationId, tenantOrganizationId)),
    ).toBe(3);
  });

  it('requires a linked, active, fully provisioned Platform Tenant before resolving a tenant principal', async () => {
    const url = '/api/v1/admin/organization/branches';
    const request = {
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${tenantBearer}` },
    } as const;

    const unlinked = await app.inject({
      ...request,
      headers: { authorization: `Bearer ${unlinkedTenantBearer}` },
    });
    expect(unlinked.statusCode).toBe(409);
    expect(unlinked.json()).toMatchObject({
      error: { code: 'TENANT_PROVISIONING_INCOMPLETE' },
    });

    await testdb.db
      .update(platformTenants)
      .set({ status: 'REGISTERED', provisioningStatus: 'PENDING' })
      .where(eq(platformTenants.organizationId, tenantOrganizationId));
    const pending = await app.inject(request);
    expect(pending.statusCode).toBe(409);
    expect(pending.json()).toMatchObject({ error: { code: 'TENANT_PROVISIONING_INCOMPLETE' } });

    await testdb.db
      .update(platformTenants)
      .set({
        status: 'SUSPENDED',
        provisioningStatus: 'COMPLETED',
        suspendedReason: 'Test suspension',
      })
      .where(eq(platformTenants.organizationId, tenantOrganizationId));
    const suspended = await app.inject(request);
    expect(suspended.statusCode).toBe(403);
    expect(suspended.json()).toMatchObject({ error: { code: 'TENANT_SUSPENDED' } });

    await testdb.db
      .update(platformTenants)
      .set({ status: 'CLOSED', suspendedReason: null })
      .where(eq(platformTenants.organizationId, tenantOrganizationId));
    const closed = await app.inject(request);
    expect(closed.statusCode).toBe(403);
    expect(closed.json()).toMatchObject({ error: { code: 'TENANT_SUSPENDED' } });

    await testdb.db
      .update(platformTenants)
      .set({ status: 'ACTIVE', provisioningStatus: 'COMPLETED', suspendedReason: null })
      .where(eq(platformTenants.organizationId, tenantOrganizationId));
  });

  it('enforces tenant warehouse branch scope, foreign-branch injection and durable replay', async () => {
    const url = '/api/v1/admin/organization/warehouses';
    const missing = await app.inject({ method: 'GET', url });
    expect(missing.statusCode).toBe(401);
    const wrongAudience = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${jwt('tenant-http-owner', 'platform-api')}` },
    });
    expect(wrongAudience.statusCode).toBe(401);
    const denied = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${deniedTenantBearer}` },
    });
    expect(denied.statusCode).toBe(403);
    const noScope = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${tenantBearer}`, 'idempotency-key': newId() },
      payload: { branchId: unscopedTenantBranchId, code: 'NO-SCOPE', name: 'No scope' },
    });
    expect(noScope.statusCode).toBe(403);
    expect(noScope.json()).toMatchObject({ error: { code: 'BRANCH_ACCESS_DENIED' } });

    const foreignInjection = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${tenantBearer}`, 'idempotency-key': newId() },
      payload: { branchId: foreignTenantBranchId, code: 'FOREIGN', name: 'Foreign injection' },
    });
    // A foreign branch is indistinguishable from a missing branch to avoid an
    // IDOR existence oracle (tenant isolation Layer 2).
    expect(foreignInjection.statusCode).toBe(404);
    expect(foreignInjection.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } });

    const missingKey = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${tenantBearer}` },
      payload: { branchId: tenantBranchId, code: 'HTTP-WH', name: 'HTTP warehouse' },
    });
    expect(missingKey.statusCode).toBe(422);
    expect(missingKey.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });

    const request = {
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${tenantBearer}`, 'idempotency-key': newId() },
      payload: { branchId: tenantBranchId, code: 'HTTP-WH', name: 'HTTP warehouse' },
    } as const;
    const created = await app.inject(request);
    const replay = await app.inject(request);
    const conflict = await app.inject({
      ...request,
      payload: { ...request.payload, name: 'Changed' },
    });
    expect(created.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(
      await testdb.db.$count(warehouses, eq(warehouses.organizationId, tenantOrganizationId)),
    ).toBe(1);
    const listed = await app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${tenantBearer}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toEqual(
      expect.arrayContaining([expect.objectContaining({ branchId: tenantBranchId })]),
    );
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
