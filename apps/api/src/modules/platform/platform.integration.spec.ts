import {
  integrationOutbox,
  newId,
  platformCapabilities,
  platformPrincipalRoles,
  platformPrincipals,
  platformRoleCapabilities,
  platformRoles,
  platformTenants,
  supportSessions,
} from '@commerce-platform/database';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@commerce-platform/contracts';
import { OrganizationService } from '../organization/application/organization.service';
import { OrganizationRepository } from '../organization/infrastructure/organization.repository';
import { DatabasePlatformAuthorizationProvider } from './application/platform-authorization.provider';
import { PlatformService } from './application/platform.service';
import { PlatformTenantRepository } from './infrastructure/platform-tenant.repository';
import { DatabasePlatformPrincipalResolver } from './application/authenticated-principal.provider';

describe('Platform Management persistence', () => {
  let testdb: TestDatabase;
  let ready = false;
  let organizations: OrganizationService;
  let service: PlatformService;
  let repository: PlatformTenantRepository;
  const resolved = new Map<
    string,
    import('../../common/auth/authenticated-principal').PlatformUserPrincipal
  >();
  const registrations = new Map<
    string,
    import('./application/platform-registration.contract').TrustedRegistrationSnapshot
  >();
  const command = (platformUserId: string) => ({
    principal: resolved.get(platformUserId)!,
    correlationId: newId(),
    causationId: newId(),
  });
  beforeAll(async () => {
    testdb = await createTestDatabase();
    organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    repository = new PlatformTenantRepository();
    service = new PlatformService(
      testdb.db,
      repository,
      new DatabasePlatformAuthorizationProvider(testdb.db),
      { resolveTrustedRegistration: async (reference) => registrations.get(reference)! },
    );
    ready = true;
  });
  afterAll(async () => {
    if (ready) await testdb.teardown();
  });
  async function principal(capabilities: string[]) {
    const principalId = newId();
    const roleId = newId();
    await testdb.db.insert(platformPrincipals).values({
      id: principalId,
      supabaseUserId: `supabase-${principalId}`,
    });
    await testdb.db
      .insert(platformRoles)
      .values({ id: roleId, code: `ROLE-${roleId}`, name: 'Test role' });
    await testdb.db.insert(platformPrincipalRoles).values({ principalId, roleId });
    for (const code of capabilities) {
      const capabilityId = newId();
      await testdb.db
        .insert(platformCapabilities)
        .values({ id: capabilityId, code, description: code })
        .onConflictDoNothing();
      const [capability] = await testdb.db
        .select({ id: platformCapabilities.id })
        .from(platformCapabilities)
        .where(eq(platformCapabilities.code, code));
      await testdb.db
        .insert(platformRoleCapabilities)
        .values({ roleId, capabilityId: capability!.id });
    }
    resolved.set(
      principalId,
      await new DatabasePlatformPrincipalResolver(testdb.db).resolveVerifiedSupabaseSubject(
        `supabase-${principalId}`,
      ),
    );
    return principalId;
  }
  async function registered(actor: string) {
    const organization = await organizations.createOrganization({ name: `Platform ${newId()}` });
    const reference = `registration-${newId()}`;
    registrations.set(reference, {
      reference,
      organizationId: organization.organization.id,
      requestedOrganizationName: organization.organization.name,
      owner: {
        supabaseSubject: `owner-${newId()}`,
        email: 'owner@example.test',
        displayName: 'Owner',
      },
      verifiedAt: new Date(),
    });
    const result = await service.register({
      registrationReference: reference,
      ...command(actor),
    });
    const tenant = await repository.find(testdb.db, result.tenant.id);
    tenant!.completeProvisioning();
    await repository.save(testdb.db, tenant!, {
      actorId: 'test-provisioning',
      correlationId: newId(),
      causationId: newId(),
    });
    return { organizationId: organization.organization.id, tenantId: result.tenant.id };
  }
  it('persists lifecycle with server-resolved capability and tenant-scoped architecture-58 outbox', async () => {
    const owner = await principal(['tenant.suspend']);
    const t = await registered(owner);
    await service.activate({ tenantId: t.tenantId, ...command(owner) });
    await service.suspend({ tenantId: t.tenantId, reason: 'Operator review', ...command(owner) });
    const [tenant] = await testdb.db
      .select()
      .from(platformTenants)
      .where(eq(platformTenants.id, t.tenantId));
    expect(tenant).toMatchObject({ status: 'SUSPENDED', suspendedReason: 'Operator review' });
    const rows = await testdb.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, t.tenantId));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => (r.payload as { eventScope: string }).eventScope === 'TENANT')).toBe(
      true,
    );
  });
  it('does not accept completed provisioning from registration input', async () => {
    const owner = await principal(['tenant.suspend']);
    const organization = await organizations.createOrganization({ name: `Pending ${newId()}` });
    const reference = `registration-${newId()}`;
    registrations.set(reference, {
      reference,
      organizationId: organization.organization.id,
      requestedOrganizationName: organization.organization.name,
      owner: {
        supabaseSubject: `owner-${newId()}`,
        email: 'owner@example.test',
        displayName: 'Owner',
      },
      verifiedAt: new Date(),
    });
    const registeredTenant = await service.register({
      registrationReference: reference,
      ...command(owner),
    });
    await expect(
      service.activate({ tenantId: registeredTenant.tenant.id, ...command(owner) }),
    ).rejects.toMatchObject({ code: ERROR_CODES.TENANT_PROVISIONING_INCOMPLETE });
  });
  it('rejects stale CAS writes without appending an outbox event', async () => {
    const owner = await principal(['tenant.suspend']);
    const t = await registered(owner);
    const first = await repository.find(testdb.db, t.tenantId);
    const stale = await repository.find(testdb.db, t.tenantId);
    first!.suspend('first');
    await repository.save(testdb.db, first!, {
      actorId: owner,
      correlationId: newId(),
      causationId: newId(),
    });
    stale!.suspend('stale');
    await expect(
      repository.save(testdb.db, stale!, {
        actorId: owner,
        correlationId: newId(),
        causationId: newId(),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_VERSION_CONFLICT });
  });
  it('TEN-004 denies a wrong operator and persists expiry before denying expired support access', async () => {
    const requester = await principal(['tenant.suspend', 'support.session']);
    const other = await principal(['support.session']);
    const t = await registered(requester);
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const requested = await service.requestSupport({
      tenantId: t.tenantId,
      reason: 'Ticket 123',
      expiresAt,
      ...command(requester),
    });
    const sessionId = (await repository.find(testdb.db, t.tenantId))!.sessions[0]!.id;
    await service.startSupport({ tenantId: t.tenantId, sessionId, ...command(requester) });
    await expect(
      service.assertOperatorBoundActiveSupportSession({
        organizationId: t.organizationId,
        supportSessionId: sessionId,
        ...command(other),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PERMISSION_DENIED });
    await expect(
      service.assertOperatorBoundActiveSupportSession({
        organizationId: t.organizationId,
        supportSessionId: sessionId,
        now: new Date(expiresAt.getTime() + 1),
        ...command(requester),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.OPERATION_NOT_ALLOWED });
    const [expired] = await testdb.db
      .select()
      .from(supportSessions)
      .where(eq(supportSessions.id, sessionId));
    expect(expired).toMatchObject({
      status: 'EXPIRED',
      endReason: 'expired',
      endedAt: expect.any(Date),
    });
    const events = await testdb.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, requested.tenant.id));
    expect(events.some((event) => event.eventType === 'platform.support-access-ended')).toBe(true);
  });
  it('rejects cross-tenant support-session injection at the composite tenant foreign key', async () => {
    const owner = await principal(['tenant.suspend']);
    const a = await registered(owner);
    const b = await registered(owner);
    await expect(
      testdb.client.query(
        "INSERT INTO platform.support_sessions (id, tenant_id, organization_id, reason, requested_by, requested_by_platform_user_id, requested_at, expires_at) VALUES ($1, $2, $3, $4, $5::text, $5::uuid, now(), now() + interval '1 hour')",
        [newId(), a.tenantId, b.organizationId, 'attack', owner],
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'support_sessions_tenant_organization_fk',
    });
  });
  it('rejects raw terminal support states without complete audit fields', async () => {
    const owner = await principal(['tenant.suspend']);
    const t = await registered(owner);
    await expect(
      testdb.client.query(
        "INSERT INTO platform.support_sessions (id, tenant_id, organization_id, status, reason, requested_by, requested_by_platform_user_id, requested_at, expires_at) VALUES ($1, $2, $3, 'EXPIRED', 'attack', $4::text, $4::uuid, now(), now() + interval '1 hour')",
        [newId(), t.tenantId, t.organizationId, owner],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'support_sessions_terminal_audit_check' });
    const sessionId = newId();
    await testdb.client.query(
      "INSERT INTO platform.support_sessions (id, tenant_id, organization_id, reason, requested_by, requested_by_platform_user_id, requested_at, expires_at) VALUES ($1, $2, $3, 'valid', $4::text, $4::uuid, now(), now() + interval '1 hour')",
      [sessionId, t.tenantId, t.organizationId, owner],
    );
    await expect(
      testdb.client.query("UPDATE platform.support_sessions SET status = 'ENDED' WHERE id = $1", [
        sessionId,
      ]),
    ).rejects.toMatchObject({ code: '23514', constraint: 'support_sessions_terminal_audit_check' });
  });
  it('rejects a subscription link from another organization at the composite foreign key', async () => {
    const owner = await principal(['tenant.suspend']);
    const target = await registered(owner);
    const other = await organizations.createOrganization({ name: `Other ${newId()}` });
    const planId = newId();
    const subscriptionId = newId();
    await testdb.client.query(
      "INSERT INTO entitlements.plans (id, code, name, status) VALUES ($1, $2, 'Plan', 'ACTIVE')",
      [planId, `PLAN-${planId}`],
    );
    await testdb.client.query(
      "INSERT INTO subscription.subscriptions (id, organization_id, plan_id, status, billing_cycle, started_at, current_period_start, current_period_end) VALUES ($1, $2, $3, 'ACTIVE', 'MONTHLY', now(), now(), now() + interval '1 month')",
      [subscriptionId, other.organization.id, planId],
    );
    await expect(
      testdb.client.query('UPDATE platform.tenants SET subscription_id = $1 WHERE id = $2', [
        subscriptionId,
        target.tenantId,
      ]),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'platform_tenants_subscription_organization_fk',
    });
  });
});
