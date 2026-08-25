import { integrationOutbox, newId, tenantOverrides, users } from '@commerce-platform/database';
import { eq } from 'drizzle-orm';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { OrganizationService } from '../organization/application/organization.service';
import { OrganizationRepository } from '../organization/infrastructure/organization.repository';
import { EntitlementService } from './application/entitlement.service';
import { PlanService } from './application/plan.service';
import type { SubscriptionStatusContract } from './contracts';
import { PlanRepository } from './infrastructure/plan.repository';
import { TenantOverrideRepository } from './infrastructure/tenant-override.repository';

describe('Plans & Entitlements persistence', () => {
  let testdb: TestDatabase;
  let setupComplete = false;
  let organizations: OrganizationService;
  let plans: PlanService;
  let planRepository: PlanRepository;
  let overrideRepository: TenantOverrideRepository;
  const audit = () => ({ actorId: newId(), correlationId: newId(), causationId: newId() });
  beforeAll(async () => {
    testdb = await createTestDatabase();
    organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    plans = new PlanService(testdb.db, new PlanRepository(), new TenantOverrideRepository());
    planRepository = new PlanRepository();
    overrideRepository = new TenantOverrideRepository();
    setupComplete = true;
  });
  afterAll(async () => {
    if (setupComplete) await testdb.teardown();
  });
  async function activePlan(values: Array<{ code: string; value: boolean | number }>) {
    const created = await plans.createPlan({
      code: `PLAN-${newId()}`,
      name: 'Test plan',
      ...audit(),
    });
    for (const entry of values) {
      if (typeof entry.value === 'boolean')
        await plans.setPlanEntitlement({
          planId: created.plan.id,
          code: entry.code,
          value: entry.value,
          ...audit(),
        });
      else
        await plans.setPlanLimit({
          planId: created.plan.id,
          code: entry.code,
          value: entry.value,
          ...audit(),
        });
    }
    await plans.activatePlan({ planId: created.plan.id, ...audit() });
    return created.plan.id;
  }
  function entitlementService(planId: string): EntitlementService {
    const subscriptions: SubscriptionStatusContract = {
      getActiveSubscription: async (organizationId) => ({
        organizationId,
        planId,
        status: 'ACTIVE',
      }),
    };
    return new EntitlementService(testdb.db, subscriptions, planRepository, overrideRepository);
  }
  it('SUB-001 given an active subscription whose plan is inactive when checked then it blocks the feature', async () => {
    const org = await organizations.createOrganization({ name: 'Feature blocked' });
    const plan = await plans.createPlan({
      code: `INACTIVE-${newId()}`,
      name: 'Inactive plan',
      ...audit(),
    });
    await plans.setPlanEntitlement({
      planId: plan.plan.id,
      code: 'storefront.enabled',
      value: true,
      ...audit(),
    });
    const service = entitlementService(plan.plan.id);
    await expect(service.canUseFeature(org.organization.id, 'storefront.enabled')).resolves.toEqual(
      { allowed: false, code: 'storefront.enabled', source: 'none' },
    );
  });
  it('SUB-002 given plan limit equals current usage when checked then excess creation is blocked', async () => {
    const org = await organizations.createOrganization({ name: 'Limit blocked' });
    const service = entitlementService(await activePlan([{ code: 'branches.max', value: 2 }]));
    await expect(service.checkLimit(org.organization.id, 'branches.max', 2)).resolves.toMatchObject(
      { allowed: false, limit: 2, currentUsage: 2, source: 'plan' },
    );
    await expect(service.checkLimit(org.organization.id, 'branches.max', 1)).resolves.toMatchObject(
      { allowed: true },
    );
  });
  it('SUB-003 given an expired temporary override when resolved then its plan value applies', async () => {
    const org = await organizations.createOrganization({ name: 'Override expired' });
    const userId = newId();
    await testdb.db.insert(users).values({
      id: userId,
      organizationId: org.organization.id,
      email: `${userId}@example.test`,
      name: 'Platform operator',
    });
    await plans.grantTenantEntitlementOverride({
      organizationId: org.organization.id,
      code: 'offline-pos.enabled',
      value: true,
      effectiveFrom: new Date('2025-01-01T00:00:00Z'),
      effectiveTo: new Date('2025-02-01T00:00:00Z'),
      reason: 'Expired promotional access',
      grantedBy: userId,
      ...audit(),
    });
    const service = entitlementService(
      await activePlan([{ code: 'offline-pos.enabled', value: false }]),
    );
    await expect(
      service.canUseFeature(org.organization.id, 'offline-pos.enabled'),
    ).resolves.toEqual({ allowed: false, code: 'offline-pos.enabled', source: 'plan' });
  });
  it('given a subscription response for another organization when resolved then entitlement access fails closed', async () => {
    const org = await organizations.createOrganization({ name: 'Subscription scope target' });
    const other = await organizations.createOrganization({ name: 'Subscription scope source' });
    const planId = await activePlan([{ code: 'storefront.enabled', value: true }]);
    const service = new EntitlementService(
      testdb.db,
      {
        getActiveSubscription: async () => ({
          organizationId: other.organization.id,
          planId,
          status: 'ACTIVE',
        }),
      },
      planRepository,
      overrideRepository,
    );
    await expect(service.canUseFeature(org.organization.id, 'storefront.enabled')).resolves.toEqual(
      {
        allowed: false,
        code: 'storefront.enabled',
        source: 'none',
      },
    );
  });
  it('given a current override when resolved then it wins the plan and after expiry the plan applies', async () => {
    const org = await organizations.createOrganization({ name: 'Override precedence' });
    const userId = newId();
    await testdb.db.insert(users).values({
      id: userId,
      organizationId: org.organization.id,
      email: `${userId}@example.test`,
      name: 'Override operator',
    });
    const granted = await plans.grantTenantEntitlementOverride({
      organizationId: org.organization.id,
      code: 'storefront.enabled',
      value: true,
      effectiveFrom: new Date(Date.now() - 60_000),
      reason: 'Temporary access',
      grantedBy: userId,
      ...audit(),
    });
    const service = entitlementService(
      await activePlan([{ code: 'storefront.enabled', value: false }]),
    );
    await expect(
      service.canUseFeature(org.organization.id, 'storefront.enabled'),
    ).resolves.toMatchObject({
      allowed: true,
      source: 'override',
    });
    await testdb.db
      .update(tenantOverrides)
      .set({ effectiveTo: new Date(Date.now() - 1) })
      .where(eq(tenantOverrides.id, granted.overrideId));
    await expect(
      service.canUseFeature(org.organization.id, 'storefront.enabled'),
    ).resolves.toMatchObject({
      allowed: false,
      source: 'plan',
    });
  });
  it('given concurrent plan writes when the stale aggregate saves then CAS rejects it and does not append an event', async () => {
    const planId = await activePlan([{ code: 'storefront.enabled', value: false }]);
    const first = await planRepository.findPlan(testdb.db, planId);
    const stale = await planRepository.findPlan(testdb.db, planId);
    first!.setEntitlement('storefront.enabled', true);
    await planRepository.save(testdb.db, first!, audit());
    stale!.setEntitlement('storefront.enabled', true);
    let error: unknown;
    try {
      await planRepository.save(testdb.db, stale!, audit());
    } catch (caught) {
      error = caught;
    }
    expect(isPlatformError(error)).toBe(true);
    expect((error as { code: string }).code).toBe(ERROR_CODES.RESOURCE_VERSION_CONFLICT);
    const rows = await testdb.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, planId));
    expect(rows).toHaveLength(4); // create, set, activate, winning set only
  });
  it('given a plan outbox event when persisted then it is a valid GLOBAL architecture-58 envelope and rollback emits none', async () => {
    const created = await plans.createPlan({
      code: `OUTBOX-${newId()}`,
      name: 'Outbox plan',
      ...audit(),
    });
    const rows = await testdb.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, created.plan.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      eventScope: 'GLOBAL',
      organizationId: null,
      eventVersion: 1,
      aggregateType: 'Plan',
      aggregateId: created.plan.id,
      actor: expect.any(Object),
      payload: { planId: created.plan.id },
    });
    const rollbackPlan = await planRepository.findPlan(testdb.db, created.plan.id);
    rollbackPlan!.setEntitlement('storefront.enabled', true);
    await expect(
      testdb.db.transaction(async (tx) => {
        await planRepository.save(tx, rollbackPlan!, audit());
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');
    const postRollback = await testdb.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, created.plan.id));
    expect(postRollback).toHaveLength(1);
  });
  it('given an override code/value mismatch when granted then the typed registry rejects it', async () => {
    const org = await organizations.createOrganization({ name: 'Registry mismatch' });
    const userId = newId();
    await testdb.db.insert(users).values({
      id: userId,
      organizationId: org.organization.id,
      email: `${userId}@example.test`,
      name: 'Operator',
    });
    await expect(
      plans.grantTenantEntitlementOverride({
        organizationId: org.organization.id,
        code: 'branches.max',
        value: true,
        effectiveFrom: new Date(),
        reason: 'Invalid feature value',
        grantedBy: userId,
        ...audit(),
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });
  it('given a raw override insert with another tenant actor when inserted then the composite tenant FK rejects it', async () => {
    const orgA = await organizations.createOrganization({ name: 'Override A' });
    const orgB = await organizations.createOrganization({ name: 'Override B' });
    const userB = newId();
    await testdb.db.insert(users).values({
      id: userB,
      organizationId: orgB.organization.id,
      email: `${userB}@example.test`,
      name: 'Tenant B actor',
    });
    let error: { code?: string; constraint?: string } | null = null;
    try {
      await testdb.client.query(
        `INSERT INTO entitlements.tenant_overrides (id, organization_id, entitlement_code, value_json, effective_from, reason, granted_by) VALUES ($1, $2, $3, $4::jsonb, now(), $5, $6)`,
        [
          newId(),
          orgA.organization.id,
          'storefront.enabled',
          JSON.stringify(true),
          'attack',
          userB,
        ],
      );
    } catch (caught) {
      error = caught as { code?: string; constraint?: string };
    }
    expect(error?.code).toBe('23503');
    expect(error?.constraint).toBe('tenant_overrides_granted_by_tenant_fk');
  });
});
