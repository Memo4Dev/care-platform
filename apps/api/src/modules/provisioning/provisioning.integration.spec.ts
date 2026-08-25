import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import {
  integrationOutbox,
  newId,
  platformTenants,
  tenantProvisioning,
} from '@commerce-platform/database';
import { OrganizationService } from '../organization/application/organization.service';
import { OrganizationContractProvider } from '../organization/application/organization-contracts.provider';
import { OrganizationProvisioningService } from '../organization/application/organization-provisioning.service';
import { OrganizationRepository } from '../organization/infrastructure/organization.repository';
import { IdentityProvisioningService } from '../identity/application/identity-provisioning.service';
import { RoleRepository } from '../identity/infrastructure/role.repository';
import { UserRepository } from '../identity/infrastructure/user.repository';
import { PlatformTenant } from '../platform/domain/platform-tenant';
import { PlatformTenantRepository } from '../platform/infrastructure/platform-tenant.repository';
import { PlatformProvisioningService } from '../platform/application/platform-provisioning.service';
import { TenantProvisioningService } from './application/tenant-provisioning.service';
import { TenantProvisioningRepository } from './infrastructure/tenant-provisioning.repository';
import { EntitlementService } from '../entitlements/application/entitlement.service';
import { PlanRepository } from '../entitlements/infrastructure/plan.repository';
import { TenantOverrideRepository } from '../entitlements/infrastructure/tenant-override.repository';
import { SubscriptionRepository } from '../subscriptions/infrastructure/subscription.repository';
import {
  PROVISIONING_EXECUTION_ISSUER,
  PROVISIONING_EXECUTION_VERIFIER,
  ProvisioningExecutionModule,
  type ProvisioningExecutionVerifier,
  type TrustedProvisioningExecutionIssuer,
} from '../../common/provisioning-execution/provisioning-execution.module';

describe('Tenant Provisioning (SUB-004)', () => {
  let testdb: TestDatabase;
  let service: TenantProvisioningService;
  let platform: PlatformProvisioningService;
  let executionIssuer: TrustedProvisioningExecutionIssuer;
  let executionVerifier: ProvisioningExecutionVerifier;
  let executionContext: INestApplicationContext;
  let failStorefrontOnce = true;
  let ready = false;
  beforeAll(async () => {
    testdb = await createTestDatabase();
    const organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    const organizationProvisioning = new OrganizationProvisioningService(
      organizations,
      new OrganizationContractProvider(testdb.db),
    );
    const tenants = new PlatformTenantRepository();
    executionContext = await NestFactory.createApplicationContext(ProvisioningExecutionModule, {
      logger: false,
    });
    executionIssuer = executionContext.get(PROVISIONING_EXECUTION_ISSUER);
    executionVerifier = executionContext.get(PROVISIONING_EXECUTION_VERIFIER);
    platform = new PlatformProvisioningService(testdb.db, tenants, executionVerifier);
    const identity = new IdentityProvisioningService(
      testdb.db,
      new UserRepository(),
      new RoleRepository(),
    );
    const subscriptions = new SubscriptionRepository();
    const entitlementResolution = new EntitlementService(
      testdb.db,
      {
        getActiveSubscription: (organizationId) =>
          subscriptions.findBusinessAccess(testdb.db, organizationId),
      },
      new PlanRepository(),
      new TenantOverrideRepository(),
    );
    // The storefront shell is deferred; actual entitlement resolution is still invoked.
    service = new TenantProvisioningService(
      testdb.db,
      new TenantProvisioningRepository(),
      organizationProvisioning,
      identity,
      {
        canUseFeature: async (_organizationId, code) => {
          if (failStorefrontOnce) {
            failStorefrontOnce = false;
            throw new Error('entitlement service transient failure');
          }
          return entitlementResolution.canUseFeature(_organizationId, code);
        },
        checkLimit: async () => {
          throw new Error('not used');
        },
        getLimitUsage: async () => {
          throw new Error('not used');
        },
      },
      platform,
      executionIssuer,
      executionVerifier,
    );
    ready = true;
  });
  afterAll(async () => {
    if (ready) await testdb.teardown();
    await executionContext?.close();
  });

  it('provisions owner, branch and warehouse once; failure is traceable, retry resumes, and the platform tenant remains unavailable until completion', async () => {
    const organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    const organization = await organizations.createOrganization({
      name: 'Provisioned organization',
    });
    const planId = newId();
    const subscriptionId = newId();
    await testdb.client.query(
      `INSERT INTO entitlements.plans (id, code, name, status) VALUES ($1, $2, 'Provisioning plan', 'ACTIVE')`,
      [planId, `PROVISION-${planId}`],
    );
    await testdb.client.query(
      `INSERT INTO subscription.subscriptions (id, organization_id, plan_id, status, billing_cycle, started_at, current_period_start, current_period_end)
       VALUES ($1, $2, $3, 'ACTIVE', 'MONTHLY', now(), now(), now() + interval '1 day')`,
      [subscriptionId, organization.organization.id, planId],
    );
    const tenant = PlatformTenant.register({
      id: newId(),
      organizationId: organization.organization.id,
      subscriptionId,
      subscriptionVersion: 1,
    });
    const tenants = new PlatformTenantRepository();
    const registrationReference = `registration-${newId()}`;
    const registration = {
      reference: registrationReference,
      organizationId: organization.organization.id,
      requestedOrganizationName: 'Provisioned organization',
      owner: {
        supabaseSubject: 'supabase-owner-subject',
        email: 'owner@example.test',
        displayName: 'Owner',
      },
      verifiedAt: new Date(),
    };
    await tenants.save(
      testdb.db,
      tenant,
      {
        actorId: 'operator',
        correlationId: newId(),
        causationId: newId(),
      },
      registration,
    );

    // Registered tenants cannot become available before the process manager completes.
    expect(() => tenant.activate()).toThrow(/provisioning/i);
    const input = {
      registrationReference,
      correlationId: newId(),
      causationId: newId(),
    };
    await expect(
      platform.markProvisioningCompleted(testdb.db, {
        tenantId: tenant.id,
      } as never),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(service.start(input)).rejects.toThrow('transient failure');
    const [failed] = await testdb.db
      .select()
      .from(tenantProvisioning)
      .where(eq(tenantProvisioning.tenantId, tenant.id));
    expect(failed).toMatchObject({
      status: 'FAILED',
      lastError: expect.stringContaining('transient'),
    });
    await Promise.all([service.retry(input), service.retry(input)]); // concurrent duplicate delivery converges
    await service.retry(input); // terminal duplicate delivery is a no-op

    const [record] = await testdb.db
      .select()
      .from(tenantProvisioning)
      .where(eq(tenantProvisioning.tenantId, tenant.id));
    expect(record).toMatchObject({ status: 'COMPLETED', completedAt: expect.any(Date) });
    expect(record.checkpointsJson).toMatchObject({
      CreatingOrganization: { completedAt: expect.any(String) },
      CreatingIdentityDefaults: { completedAt: expect.any(String) },
      CreatingBusinessDefaults: { completedAt: expect.any(String) },
      CreatingStorefront: { skipped: true },
    });
    const counts = await testdb.client.query<{
      branches: string;
      warehouses: string;
      users: string;
    }>(
      `SELECT (SELECT count(*) FROM organization.branches WHERE organization_id = $1) AS branches,
              (SELECT count(*) FROM organization.warehouses WHERE organization_id = $1) AS warehouses,
              (SELECT count(*) FROM identity.users WHERE organization_id = $1) AS users`,
      [organization.organization.id],
    );
    expect(counts.rows[0]).toEqual({ branches: '1', warehouses: '1', users: '1' });
    const owner = await testdb.client.query<{ supabase_user_id: string }>(
      `SELECT supabase_user_id FROM identity.users WHERE organization_id = $1`,
      [organization.organization.id],
    );
    expect(owner.rows).toEqual([{ supabase_user_id: 'supabase-owner-subject' }]);
    const [persistedTenant] = await testdb.db
      .select()
      .from(platformTenants)
      .where(eq(platformTenants.id, tenant.id));
    expect(persistedTenant.provisioningStatus).toBe('COMPLETED');
    const events = await testdb.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, record.id));
    expect(
      events.some((event) => event.eventType === 'provisioning.tenant-provisioning-completed'),
    ).toBe(true);
    expect(
      events.filter((event) => event.eventType === 'provisioning.tenant-provisioning-completed'),
    ).toHaveLength(1);
    expect(
      events.some((event) => event.eventType === 'provisioning.tenant-provisioning-failed'),
    ).toBe(true);
    await expect(
      testdb.client.query(
        `UPDATE provisioning.tenant_provisioning SET last_error = 'attacker' WHERE id = $1`,
        [record.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      testdb.client.query(
        `UPDATE platform.tenants SET registration_owner_email = 'attacker@example.test' WHERE id = $1`,
        [tenant.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
  });

  it('rejects an attacker-supplied registration reference before creating process state', async () => {
    const before = await testdb.client.query<{ count: string }>(
      `SELECT count(*) FROM provisioning.tenant_provisioning`,
    );
    await expect(
      service.start({
        registrationReference: `forged-${newId()}`,
        correlationId: newId(),
        causationId: newId(),
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const after = await testdb.client.query<{ count: string }>(
      `SELECT count(*) FROM provisioning.tenant_provisioning`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('rejects a legacy Platform tenant with no explicitly verified registration snapshot', async () => {
    const organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    const organization = await organizations.createOrganization({ name: `Legacy ${newId()}` });
    const tenant = PlatformTenant.register({
      id: newId(),
      organizationId: organization.organization.id,
    });
    await new PlatformTenantRepository().save(testdb.db, tenant, {
      actorId: 'operator',
      correlationId: newId(),
      causationId: newId(),
    });
    await expect(
      service.start({
        registrationReference: 'legacy',
        correlationId: newId(),
        causationId: newId(),
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});
