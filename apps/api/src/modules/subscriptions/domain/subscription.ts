import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import type { BillingCycle, SubscriptionStatus } from '@commerce-platform/database';
import type { SubscriptionDomainEvent, SubscriptionEventType } from './events';

export interface SubscriptionPeriod {
  id: string;
  planId: string;
  periodStart: Date;
  periodEnd: Date;
  status: SubscriptionStatus;
  effectiveAt: Date;
  amount?: string | null;
  currency?: string | null;
  billingReference?: string | null;
}
export class Subscription {
  private readonly events: SubscriptionDomainEvent[] = [];
  private readonly newPeriods: SubscriptionPeriod[] = [];
  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _planId: string,
    private _status: SubscriptionStatus,
    readonly billingCycle: BillingCycle,
    readonly startedAt: Date,
    private _periodStart: Date,
    private _periodEnd: Date,
    private _trialEndsAt: Date | null,
    private _cancelAtPeriodEnd: boolean,
    private _provider: string | null,
    private _providerReference: string | null,
    private _expectedVersion: number,
    private _version: number,
    private isNew: boolean,
    periods: SubscriptionPeriod[],
    private readonly clock: () => Date,
  ) {
    this.periods = periods;
  }
  readonly periods: SubscriptionPeriod[];
  static startTrial(
    input: {
      id: string;
      organizationId: string;
      planId: string;
      billingCycle: BillingCycle;
      startedAt: Date;
      trialEndsAt: Date;
      periodEnd: Date;
      periodId: string;
    },
    options: { clock?: () => Date } = {},
  ) {
    const now = (options.clock ?? (() => new Date()))();
    if (
      input.trialEndsAt.getTime() <= input.startedAt.getTime() ||
      input.periodEnd.getTime() <= input.startedAt.getTime() ||
      input.trialEndsAt.getTime() <= now.getTime()
    )
      invalid('Trial and period end must be after start.');
    const subscription = new Subscription(
      input.id,
      input.organizationId,
      input.planId,
      'TRIAL',
      input.billingCycle,
      input.startedAt,
      input.startedAt,
      input.periodEnd,
      input.trialEndsAt,
      false,
      null,
      null,
      0,
      1,
      true,
      [],
      options.clock ?? (() => new Date()),
    );
    subscription.appendPeriod({
      id: input.periodId,
      planId: input.planId,
      periodStart: input.startedAt,
      periodEnd: input.periodEnd,
      status: 'TRIAL',
      effectiveAt: input.startedAt,
    });
    subscription.event('TrialStarted');
    return subscription;
  }
  static reconstitute(
    state: {
      id: string;
      organizationId: string;
      planId: string;
      status: SubscriptionStatus;
      billingCycle: BillingCycle;
      startedAt: Date;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      trialEndsAt: Date | null;
      cancelAtPeriodEnd: boolean;
      billingProvider: string | null;
      billingProviderReference: string | null;
      version: number;
      periods: SubscriptionPeriod[];
    },
    options: { clock?: () => Date } = {},
  ) {
    return new Subscription(
      state.id,
      state.organizationId,
      state.planId,
      state.status,
      state.billingCycle,
      state.startedAt,
      state.currentPeriodStart,
      state.currentPeriodEnd,
      state.trialEndsAt,
      state.cancelAtPeriodEnd,
      state.billingProvider,
      state.billingProviderReference,
      state.version,
      state.version,
      false,
      state.periods,
      options.clock ?? (() => new Date()),
    );
  }
  get planId() {
    return this._planId;
  }
  get status() {
    return this._status;
  }
  get version() {
    return this._version;
  }
  get hasPendingChanges() {
    return this.isNew || this._version !== this._expectedVersion;
  }
  activate(provider?: { provider?: string | null; reference?: string | null }) {
    this.require(['TRIAL']);
    this._status = 'ACTIVE';
    this._provider = provider?.provider ?? this._provider;
    this._providerReference = provider?.reference ?? this._providerReference;
    this.bump();
    this.event('SubscriptionActivated');
  }
  changePlan(input: { planId: string; effectiveAt: Date; periodId: string }) {
    this.require(['TRIAL', 'ACTIVE', 'PAST_DUE']);
    if (
      !input.planId ||
      input.planId === this._planId ||
      input.effectiveAt < this._periodStart ||
      input.effectiveAt > this._periodEnd
    )
      invalid('Plan change must be distinct and effective in the current period.');
    this._planId = input.planId;
    this.appendPeriod({
      id: input.periodId,
      planId: input.planId,
      periodStart: input.effectiveAt,
      periodEnd: this._periodEnd,
      status: this._status,
      effectiveAt: input.effectiveAt,
    });
    this.bump();
    this.event('SubscriptionPlanChanged', input.effectiveAt);
  }
  scheduleCancellation() {
    this.require(['TRIAL', 'ACTIVE', 'PAST_DUE']);
    if (this._cancelAtPeriodEnd) invalid('Cancellation is already scheduled.');
    this._cancelAtPeriodEnd = true;
    this.bump();
    this.event('SubscriptionCancellationScheduled');
  }
  cancel() {
    this.require(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED']);
    this._status = 'CANCELLED';
    this._cancelAtPeriodEnd = false;
    this.bump();
    this.event('SubscriptionCancelled');
  }
  renew(input: {
    periodStart: Date;
    periodEnd: Date;
    periodId: string;
    billingReference?: string | null;
  }) {
    this.require(['ACTIVE', 'PAST_DUE']);
    if (
      input.periodStart.getTime() !== this._periodEnd.getTime() ||
      input.periodEnd.getTime() <= input.periodStart.getTime()
    )
      invalid('Renewal period must begin at the current period end.');
    this._periodStart = input.periodStart;
    this._periodEnd = input.periodEnd;
    this._status = 'ACTIVE';
    this._cancelAtPeriodEnd = false;
    this.appendPeriod({
      id: input.periodId,
      planId: this._planId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: 'ACTIVE',
      effectiveAt: input.periodStart,
      billingReference: input.billingReference,
    });
    this.bump();
    this.event('SubscriptionRenewed');
  }
  markPastDue() {
    this.require(['ACTIVE']);
    this._status = 'PAST_DUE';
    this.bump();
    this.event('SubscriptionPastDue');
  }
  suspend() {
    this.require(['PAST_DUE', 'ACTIVE']);
    this._status = 'SUSPENDED';
    this.bump();
    this.event('SubscriptionSuspended');
  }
  reactivate() {
    this.require(['SUSPENDED']);
    this._status = 'ACTIVE';
    this._cancelAtPeriodEnd = false;
    this.bump();
    this.event('SubscriptionReactivated');
  }
  extendTrial(input: { trialEndsAt: Date; periodId: string }) {
    this.require(['TRIAL']);
    if (input.trialEndsAt <= (this._trialEndsAt ?? this.startedAt))
      invalid('Trial extension must extend the trial.');
    this._trialEndsAt = input.trialEndsAt;
    if (input.trialEndsAt > this._periodEnd) this._periodEnd = input.trialEndsAt;
    this.appendPeriod({
      id: input.periodId,
      planId: this._planId,
      periodStart: this._periodStart,
      periodEnd: this._periodEnd,
      status: 'TRIAL',
      effectiveAt: input.trialEndsAt,
    });
    this.bump();
    this.event('TrialExtended');
  }
  collectChanges() {
    return {
      isNew: this.isNew,
      subscriptionId: this.id,
      organizationId: this.organizationId,
      planId: this._planId,
      status: this._status,
      billingCycle: this.billingCycle,
      startedAt: this.startedAt,
      currentPeriodStart: this._periodStart,
      currentPeriodEnd: this._periodEnd,
      trialEndsAt: this._trialEndsAt,
      cancelAtPeriodEnd: this._cancelAtPeriodEnd,
      billingProvider: this._provider,
      billingProviderReference: this._providerReference,
      expectedVersion: this._expectedVersion,
      nextVersion: this._version,
      newPeriods: this.newPeriods,
    };
  }
  pullDomainEvents() {
    return this.events.splice(0);
  }
  markPersisted() {
    this._expectedVersion = this._version;
    this.isNew = false;
    this.newPeriods.splice(0);
  }
  private appendPeriod(period: SubscriptionPeriod) {
    this.periods.push(period);
    this.newPeriods.push(period);
  }
  private event(type: SubscriptionEventType, effectiveAt?: Date) {
    this.events.push({
      type,
      occurredAt: this.clock(),
      subscriptionId: this.id,
      organizationId: this.organizationId,
      planId: this._planId,
      status: this._status,
      billingCycle: this.billingCycle,
      effectiveAt,
    });
  }
  private require(allowed: SubscriptionStatus[]) {
    if (!allowed.includes(this._status))
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Subscription cannot transition from ${this._status}.`,
      );
  }
  private bump() {
    this._version += 1;
  }
}
function invalid(message: string): never {
  throw PlatformError.validationFailed(message);
}
