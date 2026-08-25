import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';
import { Plan } from './plan';

describe('Plan aggregate', () => {
  const clock = () => new Date('2026-01-01T00:00:00.000Z');
  it('given a draft plan when activated and configured then it versions state and emits domain facts', () => {
    const plan = Plan.create({ id: 'plan-1', code: 'STARTER', name: 'Starter' }, { clock });
    plan.setEntitlement('storefront.enabled', true);
    plan.setLimit('branches.max', 2);
    plan.activate();
    expect(plan.collectChanges()).toMatchObject({
      status: 'ACTIVE',
      nextVersion: 4,
      entitlements: [
        { code: 'storefront.enabled', value: true },
        { code: 'branches.max', value: 2 },
      ],
    });
    expect(plan.pullDomainEvents().map((event) => event.type)).toEqual([
      'PlanCreated',
      'PlanEntitlementChanged',
      'PlanEntitlementChanged',
      'PlanActivated',
    ]);
  });
  it('given an active plan when activated again then the invalid transition is rejected', () => {
    const plan = Plan.reconstitute({
      id: 'plan-1',
      code: 'STARTER',
      name: 'Starter',
      status: 'ACTIVE',
      version: 1,
      entitlements: [],
    });
    let error: unknown;
    try {
      plan.activate();
    } catch (caught) {
      error = caught;
    }
    expect(isPlatformError(error)).toBe(true);
    expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
  });
  it('given a plan when a limit is negative or a feature is non-boolean then invariant validation rejects it', () => {
    const plan = Plan.create({ id: 'plan-1', code: 'STARTER', name: 'Starter' });
    expect(() => plan.setLimit('users.max', -1)).toThrow();
    expect(() => plan.setEntitlement('offline-pos.enabled', 1 as never)).toThrow();
  });
  it('given typed entitlement commands when code and value kind do not match then the registry rejects the write', () => {
    const plan = Plan.create({ id: 'plan-1', code: 'STARTER', name: 'Starter' });
    expect(() => plan.setEntitlement('branches.max', true)).toThrow();
    expect(() => plan.setLimit('storefront.enabled', 1)).toThrow();
    expect(() => plan.setEntitlement('unknown.enabled', true)).toThrow();
  });
});
