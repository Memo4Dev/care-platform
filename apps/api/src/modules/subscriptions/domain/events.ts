import type { BillingCycle, SubscriptionStatus } from '@commerce-platform/database';

export const SUBSCRIPTION_AGGREGATE_TYPE = 'Subscription' as const;
export type SubscriptionEventType =
  | 'TrialStarted'
  | 'TrialExtended'
  | 'SubscriptionActivated'
  | 'SubscriptionPlanChanged'
  | 'SubscriptionRenewed'
  | 'SubscriptionPastDue'
  | 'SubscriptionSuspended'
  | 'SubscriptionReactivated'
  | 'SubscriptionCancellationScheduled'
  | 'SubscriptionCancelled';
export interface SubscriptionDomainEvent {
  type: SubscriptionEventType;
  occurredAt: Date;
  subscriptionId: string;
  organizationId: string;
  planId: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  effectiveAt?: Date;
}
