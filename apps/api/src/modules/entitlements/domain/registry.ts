import { PlatformError } from '@commerce-platform/contracts';

export const FEATURE_ENTITLEMENT_CODES = [
  'storefront.enabled',
  'offline-pos.enabled',
  'advanced-reports.enabled',
  'delivery.external.enabled',
  'custom-domain.enabled',
  'multi-warehouse.enabled',
] as const;
export const LIMIT_ENTITLEMENT_CODES = [
  'branches.max',
  'users.max',
  'pos-devices.max',
  'warehouses.max',
  'storefront-products.max',
  'monthly-orders.max',
] as const;
export type FeatureEntitlementCode = (typeof FEATURE_ENTITLEMENT_CODES)[number];
export type LimitEntitlementCode = (typeof LIMIT_ENTITLEMENT_CODES)[number];
export type EntitlementCode = FeatureEntitlementCode | LimitEntitlementCode;

export function assertFeatureEntitlement(code: string, value: unknown): asserts value is boolean {
  if (!FEATURE_ENTITLEMENT_CODES.includes(code as FeatureEntitlementCode))
    invalidCode(code, 'feature');
  if (typeof value !== 'boolean') invalidValue(code, 'boolean');
}
export function assertLimitEntitlement(code: string, value: unknown): asserts value is number {
  if (!LIMIT_ENTITLEMENT_CODES.includes(code as LimitEntitlementCode)) invalidCode(code, 'limit');
  if (!Number.isInteger(value) || (value as number) < 0)
    invalidValue(code, 'a non-negative integer');
}
export function assertEntitlementValue(
  code: string,
  value: unknown,
): asserts value is boolean | number {
  if (FEATURE_ENTITLEMENT_CODES.includes(code as FeatureEntitlementCode))
    return assertFeatureEntitlement(code, value);
  if (LIMIT_ENTITLEMENT_CODES.includes(code as LimitEntitlementCode))
    return assertLimitEntitlement(code, value);
  invalidCode(code, 'entitlement');
}
function invalidCode(code: string, kind: string): never {
  throw PlatformError.validationFailed(`Unknown ${kind} entitlement code "${code}".`, {
    details: { field: 'code', code },
  });
}
function invalidValue(code: string, expected: string): never {
  throw PlatformError.validationFailed(`Entitlement ${code} must have ${expected} value.`, {
    details: { field: 'value', code },
  });
}
