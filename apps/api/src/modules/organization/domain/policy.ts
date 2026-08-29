import { PlatformError } from '@commerce-platform/contracts';

/**
 * Organization policy value objects and the SetPolicy command behavior.
 *
 * docs/architecture/10-organization.md defines eight SetXPolicy commands
 * (SetReturnPolicy, SetRefundPolicy, ...). They all map to ONE domain command,
 * {@link setPolicy}, parameterized by a closed {@link PolicyType} union; the
 * application layer exposes them as one typed `setPolicy(policyType, value)`
 * command instead of eight near-identical methods. Policy changes are recorded
 * as immutable history entries: every change appends a new versioned entry and
 * emits an OrganizationPolicyChanged event; existing rows are never rewritten
 * ("Policy changes are versioned and do not rewrite completed transactions").
 *
 * This file is deliberately free of persistence/framework imports. The
 * Postgres enum mirroring these values lives in
 * packages/database/src/schema/organization.ts; a unit test asserts both
 * lists stay identical so the domain language cannot drift from storage.
 */

export const POLICY_TYPES = [
  'RETURN',
  'REFUND',
  'PURCHASE',
  'ORDER_APPROVAL',
  'OFFLINE',
  'CREDIT',
  'DELIVERY',
  'INVENTORY',
  'CART',
] as const;

export type PolicyType = (typeof POLICY_TYPES)[number];

/** Structured JSON payload stored per policy entry. */
export type PolicyValue = Record<string, unknown>;

/** Narrow an unknown runtime value to the closed policy-type union. */
export function isPolicyType(value: unknown): value is PolicyType {
  return typeof value === 'string' && (POLICY_TYPES as readonly string[]).includes(value);
}

/** Throws VALIDATION_FAILED unless {@link value} is a plain JSON object. */
export function assertPolicyValue(value: unknown): asserts value is PolicyValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw PlatformError.validationFailed('Policy value must be a plain JSON object.', {
      details: { field: 'value' },
    });
  }
}

/**
 * Provisional M1 fallback values returned by GetOrganizationPolicy when no
 * explicit policy row exists yet (source: 'default').
 *
 * DECISION FLAG (pending product ratification — see docs/state/DECISIONS.md):
 * these defaults were chosen conservatively because no architecture doc fixes
 * initial policy values. Money-moving capabilities default OFF; operational
 * features default ON. Changing any entry is a business decision and must go
 * through human review.
 */
export const DEFAULT_POLICY_VALUES: Readonly<Record<PolicyType, PolicyValue>> = Object.freeze({
  RETURN: { enabled: false },
  REFUND: { enabled: false },
  PURCHASE: { enabled: true },
  ORDER_APPROVAL: { required: false },
  OFFLINE: { enabled: true },
  CREDIT: { enabled: false },
  DELIVERY: { enabled: false },
  INVENTORY: { enabled: true },
  CART: { holdReservationTtlMinutes: 15 },
});

/**
 * Internal per-organization policy state carried by the aggregate:
 * latest known value per policy type plus the monotonic version counter.
 * Versions are assigned per ORGANIZATION (not per policy type), matching the
 * UNIQUE (organization_id, version) guarantee of the persistence schema.
 */
export interface PolicyState {
  /** Latest stored value per policy type (empty when none persisted yet). */
  readonly latest: Map<PolicyType, { readonly value: PolicyValue; readonly version: number }>;
  /** Next per-organization monotonic policy version to assign. */
  nextVersion: number;
}

export interface PendingPolicyChange {
  readonly policyType: PolicyType;
  readonly value: PolicyValue;
  /** Version assigned by the aggregate's monotonic counter. */
  readonly version: number;
}

/**
 * Domain command: SetPolicy(policyType, value).
 *
 * Appends exactly one immutable history entry per invocation: updates the
 * in-memory "latest" projection, assigns the next monotonic version and
 * returns the pending persistence record. The aggregate owns event collection
 * and journaling around this call.
 */
export function setPolicy(
  state: PolicyState,
  organizationId: string,
  policyType: PolicyType,
  value: PolicyValue,
): PendingPolicyChange {
  if (!isPolicyType(policyType)) {
    throw PlatformError.validationFailed(
      `Unknown organization policy type "${String(policyType)}".`,
      { details: { field: 'policyType', allowedValues: POLICY_TYPES } },
    );
  }
  assertPolicyValueFor(policyType, value);

  const version = state.nextVersion;
  state.nextVersion += 1;
  state.latest.set(policyType, { value, version });

  return { policyType, value, version };
}

function assertPolicyValueFor(
  policyType: PolicyType,
  value: unknown,
): asserts value is PolicyValue {
  assertPolicyValue(value);
  if (policyType !== 'CART') return;

  const keys = Object.keys(value);
  const ttl = value.holdReservationTtlMinutes;
  if (
    keys.length !== 1 ||
    typeof ttl !== 'number' ||
    !Number.isInteger(ttl) ||
    ttl < 1 ||
    ttl > 1440
  ) {
    throw PlatformError.validationFailed(
      'CART policy holdReservationTtlMinutes must be an integer from 1 through 1440.',
      { details: { field: 'value.holdReservationTtlMinutes', policyType: 'CART' } },
    );
  }
}
