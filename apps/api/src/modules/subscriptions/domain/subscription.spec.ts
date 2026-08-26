import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';
import { Subscription } from './subscription';

const start = new Date('2026-01-01T00:00:00Z');
const end = new Date('2026-02-01T00:00:00Z');
function trial() {
  return Subscription.startTrial(
    {
      id: 'sub-1',
      organizationId: 'org-1',
      planId: 'plan-1',
      billingCycle: 'MONTHLY',
      startedAt: start,
      trialEndsAt: new Date('2026-01-14T00:00:00Z'),
      periodEnd: end,
      periodId: 'period-1',
    },
    { clock: () => start },
  );
}
describe('Subscription aggregate', () => {
  it('transitions trial through active, past due, suspended and reactivated with events', () => {
    const sub = trial();
    sub.activate();
    sub.markPastDue();
    sub.suspend();
    sub.reactivate();
    expect(sub.status).toBe('ACTIVE');
    expect(sub.pullDomainEvents().map((event) => event.type)).toEqual([
      'TrialStarted',
      'SubscriptionActivated',
      'SubscriptionPastDue',
      'SubscriptionSuspended',
      'SubscriptionReactivated',
    ]);
  });
  it('rejects invalid transitions', () => {
    const sub = trial();
    expect(() =>
      sub.renew({ periodId: 'p', periodStart: end, periodEnd: new Date('2026-03-01T00:00:00Z') }),
    ).toThrow();
    try {
      sub.cancel();
      sub.activate();
    } catch (error) {
      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    }
  });
  it('accepts renewal with a distinct Date instance representing the period-end instant', () => {
    const sub = trial();
    sub.activate();
    sub.renew({
      periodId: 'period-2',
      periodStart: new Date(end.getTime()),
      periodEnd: new Date('2026-03-01T00:00:00Z'),
    });
    expect(sub.status).toBe('ACTIVE');
    expect(sub.periods).toHaveLength(2);
  });
  it('rejects an already expired trial', () => {
    expect(() =>
      Subscription.startTrial(
        {
          id: 'expired-subscription',
          organizationId: 'org-1',
          planId: 'plan-1',
          billingCycle: 'MONTHLY',
          startedAt: new Date('2025-01-01T00:00:00Z'),
          trialEndsAt: new Date('2025-01-02T00:00:00Z'),
          periodEnd: new Date('2025-02-01T00:00:00Z'),
          periodId: 'period-1',
        },
        { clock: () => new Date('2025-01-03T00:00:00Z') },
      ),
    ).toThrow();
  });
  it('records plan changes and trial extensions as new immutable period facts', () => {
    const sub = trial();
    sub.extendTrial({ trialEndsAt: new Date('2026-01-20T00:00:00Z'), periodId: 'period-2' });
    sub.changePlan({
      planId: 'plan-2',
      effectiveAt: new Date('2026-01-21T00:00:00Z'),
      periodId: 'period-3',
    });
    expect(sub.periods).toHaveLength(3);
    expect(sub.collectChanges().newPeriods).toHaveLength(3);
  });
});
