/** Read-only Subscription & Billing capability contract (architecture 60). */
export const SUBSCRIPTION_STATUS = Symbol('SUBSCRIPTION_STATUS');
export interface ActiveSubscription {
  organizationId: string;
  planId: string;
  status: 'TRIAL' | 'ACTIVE';
}
export interface SubscriptionStatusContract {
  getActiveSubscription(organizationId: string): Promise<ActiveSubscription | null>;
}
