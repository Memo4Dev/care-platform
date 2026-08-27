import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

/**
 * Purchasing domain invariants and validation helpers.
 *
 * Pure functions — no side effects, no framework imports. Each function throws
 * a PlatformError with a stable error code on violation, making the failure
 * machine-readable for both API consumers and integration consumers.
 */

// ---------------------------------------------------------------------------
// Quantity validation
// ---------------------------------------------------------------------------

/**
 * Validates that a numeric quantity is strictly positive (> 0).
 * Throws VALIDATION_FAILED when the value is missing, non-numeric, or <= 0.
 */
export function validatePositiveQuantity(value: number, fieldName: string): void {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, `${fieldName} must be a valid number.`, {
      details: { field: fieldName, value },
    });
  }
  if (value <= 0) {
    throw PlatformError.of(
      ERROR_CODES.VALIDATION_FAILED,
      `${fieldName} must be greater than zero.`,
      {
        details: { field: fieldName, value },
      },
    );
  }
}

/**
 * Validates that a numeric quantity is non-negative (>= 0).
 * Throws VALIDATION_FAILED when the value is negative.
 */
export function validateNonNegativeQuantity(value: number, fieldName: string): void {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, `${fieldName} must be a valid number.`, {
      details: { field: fieldName, value },
    });
  }
  if (value < 0) {
    throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, `${fieldName} must be non-negative.`, {
      details: { field: fieldName, value },
    });
  }
}

// ---------------------------------------------------------------------------
// Receipt completeness
// ---------------------------------------------------------------------------

/**
 * Validates that an inspected goods-receipt line balances:
 *   quantityAccepted + quantityRejected === quantityReceived
 *
 * Throws VALIDATION_FAILED when the three quantities do not reconcile.
 */
export function validateReceiptCompleteness(
  received: number,
  accepted: number,
  rejected: number,
): void {
  validatePositiveQuantity(received, 'quantityReceived');
  validatePositiveQuantity(accepted, 'quantityAccepted');
  validateNonNegativeQuantity(rejected, 'quantityRejected');

  if (accepted + rejected !== received) {
    throw PlatformError.of(
      ERROR_CODES.VALIDATION_FAILED,
      `Receipt line does not balance: quantityReceived (${received}) must equal quantityAccepted (${accepted}) + quantityRejected (${rejected}).`,
      { details: { received, accepted, rejected } },
    );
  }
}

// ---------------------------------------------------------------------------
// Purchase Order status transitions
// ---------------------------------------------------------------------------

/**
 * Allowed Purchase Order status transitions per docs/architecture/16-purchasing.md:
 *
 *   DRAFT → SUBMITTED → APPROVED → SENT → PARTIALLY_RECEIVED → RECEIVED
 *                                            ↘ CANCELLED
 *   SUBMITTED → REJECTED
 *   DRAFT     → CANCELLED
 *
 * A Goods Receipt confirmation drives SENT → PARTIALLY_RECEIVED / RECEIVED at
 * the application layer; those transitions are validated here so the union of
 * commands and receipt-driven updates stays consistent.
 */
const PO_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['SENT', 'CANCELLED'],
  REJECTED: [],
  SENT: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

/** Throws OPERATION_NOT_ALLOWED when the transition is not permitted. */
export function validatePOStatusTransition(current: string, target: string): void {
  const allowed = PO_STATUS_TRANSITIONS[current];
  if (!allowed) {
    throw PlatformError.of(
      ERROR_CODES.OPERATION_NOT_ALLOWED,
      `Unknown purchase order status: ${current}.`,
      { details: { current, target } },
    );
  }
  if (!allowed.includes(target)) {
    throw PlatformError.of(
      ERROR_CODES.OPERATION_NOT_ALLOWED,
      `Cannot transition purchase order from "${current}" to "${target}".`,
      { details: { current, target } },
    );
  }
}

// ---------------------------------------------------------------------------
// Goods Receipt status transitions
// ---------------------------------------------------------------------------

/**
 * Allowed Goods Receipt status transitions:
 *   PENDING → CONFIRMED
 *   PENDING → CANCELLED
 *
 * CONFIRMED is terminal and immutable (no silent edits).
 */
const GR_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: [],
  CANCELLED: [],
};

/** Throws OPERATION_NOT_ALLOWED when the transition is not permitted. */
export function validateGRStatusTransition(current: string, target: string): void {
  const allowed = GR_STATUS_TRANSITIONS[current];
  if (!allowed) {
    throw PlatformError.of(
      ERROR_CODES.OPERATION_NOT_ALLOWED,
      `Unknown goods receipt status: ${current}.`,
      { details: { current, target } },
    );
  }
  if (!allowed.includes(target)) {
    throw PlatformError.of(
      ERROR_CODES.OPERATION_NOT_ALLOWED,
      `Cannot transition goods receipt from "${current}" to "${target}".`,
      { details: { current, target } },
    );
  }
}

// ---------------------------------------------------------------------------
// Over-receipt policy
// ---------------------------------------------------------------------------

export interface OverReceiptPolicy {
  allowOverReceipt: boolean;
  /** Maximum permitted over-receipt as a percentage of ordered quantity (0-100). */
  maxOverReceiptPercent?: number;
}

/**
 * Validates whether a received quantity respects the organization's
 * over-receipt policy (org policy `PURCHASE`).
 *
 * - When over-receipt is disallowed and receivedQty > orderedQty: POLICY_VIOLATION.
 * - When over-receipt is allowed with a cap, receivedQty must be <=
 *   orderedQty * (1 + maxOverReceiptPercent / 100).
 * - When allowed with no cap, any receivedQty is permitted.
 *
 * Throws POLICY_VIOLATION on violation.
 */
export function validateOverReceiptPolicy(
  orderedQty: number,
  receivedQty: number,
  policy: OverReceiptPolicy,
): void {
  validateNonNegativeQuantity(orderedQty, 'orderedQty');
  validateNonNegativeQuantity(receivedQty, 'receivedQty');

  if (!policy.allowOverReceipt) {
    if (receivedQty > orderedQty) {
      throw PlatformError.of(
        ERROR_CODES.POLICY_VIOLATION,
        `Over-receipt is not allowed: received ${receivedQty} exceeds ordered ${orderedQty}.`,
        { details: { orderedQty, receivedQty, allowOverReceipt: false } },
      );
    }
    return;
  }

  if (policy.maxOverReceiptPercent !== undefined && policy.maxOverReceiptPercent >= 0) {
    const cap = orderedQty * (1 + policy.maxOverReceiptPercent / 100);
    if (receivedQty > cap) {
      throw PlatformError.of(
        ERROR_CODES.POLICY_VIOLATION,
        `Over-receipt exceeds maximum allowed (${policy.maxOverReceiptPercent}%): received ${receivedQty} exceeds cap ${cap} for ordered ${orderedQty}.`,
        {
          details: {
            orderedQty,
            receivedQty,
            maxOverReceiptPercent: policy.maxOverReceiptPercent,
            cap,
          },
        },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Landed cost
// ---------------------------------------------------------------------------

/**
 * Computes the per-unit landed cost for a received line.
 *
 *   totalAdditionalCost = sum(amount of all additional costs)
 *   totalAcceptedQty > 0  → unitCost + totalAdditionalCost / totalAcceptedQty
 *   totalAcceptedQty == 0 → unitCost (no allocation base)
 *
 * Result is rounded to 4 decimal places (decimal(14,4) storage).
 */
export function calculateLandedCost(
  unitCost: number,
  additionalCosts: ReadonlyArray<{ readonly amount: number }>,
  totalAcceptedQty: number,
): number {
  const totalAdditionalCost = additionalCosts.reduce((sum, c) => sum + c.amount, 0);

  if (totalAcceptedQty <= 0) {
    return round4(unitCost);
  }

  return round4(unitCost + totalAdditionalCost / totalAcceptedQty);
}

/** Round to 4 decimal places using symmetric rounding. */
function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e4) / 1e4;
}
