import {
  integrationOutbox,
  newId,
  subscriptionPeriods,
  subscriptions,
} from '@commerce-platform/database';
import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import { OrganizationRepository } from '../organization/infrastructure/organization.repository';
import { OrganizationService } from '../organization/application/organization.service';
import { PlanRepository } from '../entitlements/infrastructure/plan.repository';
import { TenantOverrideRepository } from '../entitlements/infrastructure/tenant-override.repository';
import { PlanService } from '../entitlements/application/plan.service';
import { EntitlementService } from '../entitlements/application/entitlement.service';
import { SubscriptionRepository } from './infrastructure/subscription.repository';
import { SubscriptionService } from './application/subscription.service';

describe('Subscription & Billing native PostgreSQL', () => {
  let testdb: TestDatabase;
  let organizations: OrganizationService;
  let plans: PlanService;
  let service: SubscriptionService;
  let repository: SubscriptionRepository;
  let setupComplete = false;
  const audit = () => ({ actorId: newId(), correlationId: newId(), causationId: newId() });
  beforeAll(async () => {
    testdb = await createTestDatabase();
    organizations = new OrganizationService(testdb.db, new OrganizationRepository());
    plans = new PlanService(testdb.db, new PlanRepository(), new TenantOverrideRepository());
    repository = new SubscriptionRepository();
    service = new SubscriptionService(testdb.db, repository);
    setupComplete = true;
  });
  afterAll(async () => {
    if (setupComplete) await testdb.teardown();
  });
  async function activePlan() {
    const p = await plans.createPlan({ code: `P-${newId()}`, name: 'Plan', ...audit() });
    await plans.setPlanEntitlement({
      planId: p.plan.id,
      code: 'storefront.enabled',
      value: true,
      ...audit(),
    });
    await plans.activatePlan({ planId: p.plan.id, ...audit() });
    return p.plan.id;
  }
  async function trial() {
    const org = await organizations.createOrganization({ name: `Org-${newId()}` });
    const planId = await activePlan();
    const startedAt = new Date(Date.now() - 60_000);
    const trialEndsAt = new Date(Date.now() + 86_400_000);
    const periodEnd = new Date(Date.now() + 2_592_000_000);
    const sub = await service.startTrial({
      organizationId: org.organization.id,
      planId,
      billingCycle: 'MONTHLY',
      startedAt,
      trialEndsAt,
      periodEnd,
      ...audit(),
    });
    return {
      org: org.organization,
      planId,
      startedAt,
      trialEndsAt,
      periodEnd,
      sub: sub.subscription,
    };
  }
  it('enforces one commercial subscription and tenant-scoped reads', async () => {
    const first = await trial();
    const planId = await activePlan();
    let duplicateError: { cause?: { code?: string; constraint?: string } } | undefined;
    try {
      await service.startTrial({
        organizationId: first.org.id,
        planId,
        billingCycle: 'MONTHLY',
        startedAt: new Date(Date.now() - 60_000),
        trialEndsAt: new Date(Date.now() + 86_400_000),
        periodEnd: new Date(Date.now() + 2_592_000_000),
        ...audit(),
      });
    } catch (error) {
      duplicateError = error as { cause?: { code?: string; constraint?: string } };
    }
    expect(duplicateError?.cause).toMatchObject({
      code: '23505',
      constraint: 'subscriptions_one_commercial_per_organization_unique',
    });
    const other = await organizations.createOrganization({ name: 'Other org' });
    expect(await repository.find(testdb.db, other.organization.id, first.sub.id)).toBeNull();
  });
  it('uses CAS and atomically appends periods and outbox events', async () => {
    const { org, sub, startedAt } = await trial();
    const first = await repository.find(testdb.db, org.id, sub.id);
    const stale = await repository.find(testdb.db, org.id, sub.id);
    first!.activate();
    await repository.save(testdb.db, first!, audit());
    stale!.activate();
    let error: unknown;
    try {
      await repository.save(testdb.db, stale!, audit());
    } catch (caught) {
      error = caught;
    }
    expect(isPlatformError(error)).toBe(true);
    expect((error as { code: string }).code).toBe(ERROR_CODES.RESOURCE_VERSION_CONFLICT);
    await service.changePlan({
      organizationId: org.id,
      subscriptionId: sub.id,
      planId: await activePlan(),
      effectiveAt: new Date(startedAt.getTime() + 86_400_000),
      ...audit(),
    });
    expect(
      await testdb.db
        .select()
        .from(subscriptionPeriods)
        .where(eq(subscriptionPeriods.subscriptionId, sub.id)),
    ).toHaveLength(2);
    expect(
      await testdb.db
        .select()
        .from(integrationOutbox)
        .where(eq(integrationOutbox.aggregateId, sub.id)),
    ).toHaveLength(3);
  });
  it('renews using an equal period-end instant and persists another period', async () => {
    const { org, sub, periodEnd } = await trial();
    await service.activate({ organizationId: org.id, subscriptionId: sub.id, ...audit() });
    await service.renew({
      organizationId: org.id,
      subscriptionId: sub.id,
      periodStart: new Date(periodEnd.getTime()),
      periodEnd: new Date(periodEnd.getTime() + 2_592_000_000),
      ...audit(),
    });
    expect(
      await testdb.db
        .select()
        .from(subscriptionPeriods)
        .where(eq(subscriptionPeriods.subscriptionId, sub.id)),
    ).toHaveLength(2);
  });
  it('rejects raw UPDATE and DELETE attempts against append-only subscription periods', async () => {
    const { sub } = await trial();
    const [period] = await testdb.db
      .select()
      .from(subscriptionPeriods)
      .where(eq(subscriptionPeriods.subscriptionId, sub.id));
    await expect(
      testdb.client.query(
        'UPDATE subscription.subscription_periods SET currency = $1 WHERE id = $2',
        ['USD', period!.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      testdb.client.query('DELETE FROM subscription.subscription_periods WHERE id = $1', [
        period!.id,
      ]),
    ).rejects.toMatchObject({ code: '55000' });
  });
  it('fails closed when an otherwise valid trial or active period has expired', async () => {
    const { org, sub } = await trial();
    await testdb.db
      .update(subscriptions)
      .set({ trialEndsAt: new Date(Date.now() - 1) })
      .where(eq(subscriptions.id, sub.id));
    expect(await repository.findBusinessAccess(testdb.db, org.id)).toBeNull();
    await testdb.db
      .update(subscriptions)
      .set({ status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() - 1) })
      .where(eq(subscriptions.id, sub.id));
    expect(await repository.findBusinessAccess(testdb.db, org.id)).toBeNull();
  });
  it('exposes active/trial only to entitlements and emits scoped envelopes', async () => {
    const { org, sub } = await trial();
    const entitlements = new EntitlementService(
      testdb.db,
      {
        getActiveSubscription: (organizationId) =>
          repository.findBusinessAccess(testdb.db, organizationId),
      },
      new PlanRepository(),
      new TenantOverrideRepository(),
    );
    await expect(entitlements.canUseFeature(org.id, 'storefront.enabled')).resolves.toMatchObject({
      allowed: true,
    });
    await service.activate({ organizationId: org.id, subscriptionId: sub.id, ...audit() });
    await service.markPastDue({ organizationId: org.id, subscriptionId: sub.id, ...audit() });
    await expect(entitlements.canUseFeature(org.id, 'storefront.enabled')).resolves.toMatchObject({
      allowed: false,
    });
    const [event] = await testdb.db
      .select()
      .from(integrationOutbox)
      .where(eq(integrationOutbox.aggregateId, sub.id));
    expect(event!.payload).toMatchObject({
      eventScope: 'TENANT',
      organizationId: org.id,
      aggregateType: 'Subscription',
    });
    expect(
      await testdb.db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)),
    ).toHaveLength(1);
  });
});
