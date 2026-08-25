/** Contract exposed to business modules (docs/architecture/60-module-contracts.md). */
export const ENTITLEMENT_SERVICE = Symbol('ENTITLEMENT_SERVICE');
export interface EntitlementCheck {
  allowed: boolean;
  code: string;
  source: 'plan' | 'override' | 'none';
}
export interface LimitUsage {
  allowed: boolean;
  code: string;
  limit: number | null;
  currentUsage: number;
  source: 'plan' | 'override' | 'none';
}
export interface EntitlementServiceContract {
  canUseFeature(organizationId: string, code: FeatureEntitlementCode): Promise<EntitlementCheck>;
  checkLimit(
    organizationId: string,
    code: LimitEntitlementCode,
    currentUsage: number,
  ): Promise<LimitUsage>;
  getLimitUsage(
    organizationId: string,
    code: LimitEntitlementCode,
    currentUsage: number,
  ): Promise<LimitUsage>;
}
/** Subscription & Billing port. M1-006 owns the adapter; entitlement code never reads its tables. */
export {
  SUBSCRIPTION_STATUS,
  type ActiveSubscription,
  type SubscriptionStatusContract,
} from '../../common/contracts/subscription-status';
import type { FeatureEntitlementCode, LimitEntitlementCode } from './domain/registry';
