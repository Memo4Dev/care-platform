import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

/**
 * Inventory domain invariants and validation helpers.
 *
 * Pure functions — no side effects, no framework imports. Each function throws
 * a PlatformError with a stable error code on violation, making the failure
 * machine-readable for both API consumers and integration consumers.
 */

// ---------------------------------------------------------------------------
// Quantity validation
// ---------------------------------------------------------------------------

/**
 * Validates that a numeric quantity is non-negative.
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
// Available constraint
// ---------------------------------------------------------------------------

/**
 * Validates the core inventory invariant: reserved + allocated <= onHand.
 * All three values must also be non-negative (checked implicitly).
 *
 * Called after every mutation to onHand, reserved, or allocated.
 */
export function validateAvailableConstraint(
  onHand: number,
  reserved: number,
  allocated: number,
): void {
  validateNonNegativeQuantity(onHand, 'onHand');
  validateNonNegativeQuantity(reserved, 'reserved');
  validateNonNegativeQuantity(allocated, 'allocated');

  if (reserved + allocated > onHand) {
    throw PlatformError.of(
      ERROR_CODES.INVENTORY_INSUFFICIENT,
      `reserved (${reserved}) + allocated (${allocated}) exceeds onHand (${onHand}).`,
      { details: { onHand, reserved, allocated } },
    );
  }
}

// ---------------------------------------------------------------------------
// Transfer state validation
// ---------------------------------------------------------------------------

const TRANSFER_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['RECEIVED'],
  RECEIVED: [],
  CANCELLED: [],
};

/**
 * Validates whether a transfer state transition is allowed.
 * Throws TRANSFER_INVALID_STATE when the transition is not permitted.
 */
export function validateTransferState(status: string, action: string): void {
  const allowed = TRANSFER_TRANSITIONS[status];
  if (!allowed) {
    throw PlatformError.of(
      ERROR_CODES.TRANSFER_INVALID_STATE,
      `Unknown transfer status: ${status}.`,
      { details: { status, action } },
    );
  }
  if (!allowed.includes(action)) {
    throw PlatformError.of(
      ERROR_CODES.TRANSFER_INVALID_STATE,
      `Cannot perform "${action}" on a transfer in "${status}" status.`,
      { details: { status, action } },
    );
  }
}

// ---------------------------------------------------------------------------
// Reservation status transitions
// ---------------------------------------------------------------------------

const RESERVATION_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ['CONSUMED', 'RELEASED', 'EXPIRED'],
  CONSUMED: [],
  RELEASED: [],
  EXPIRED: [],
};

/**
 * Validates whether a reservation status transition is allowed.
 * Throws OPERATION_NOT_ALLOWED when the transition is not permitted.
 */
export function validateReservationTransition(current: string, target: string): void {
  const allowed = RESERVATION_TRANSITIONS[current];
  if (!allowed) {
    throw PlatformError.of(
      ERROR_CODES.OPERATION_NOT_ALLOWED,
      `Unknown reservation status: ${current}.`,
      { details: { current, target } },
    );
  }
  if (!allowed.includes(target)) {
    throw PlatformError.of(
      ERROR_CODES.OPERATION_NOT_ALLOWED,
      `Cannot transition reservation from "${current}" to "${target}".`,
      { details: { current, target } },
    );
  }
}

// ---------------------------------------------------------------------------
// Allocation status transitions
// ---------------------------------------------------------------------------

const ALLOCATION_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ['CONSUMED', 'RELEASED', 'EXPIRED'],
  CONSUMED: [],
  RELEASED: [],
  EXPIRED: [],
};

/**
 * Validates whether an allocation status transition is allowed.
 * Throws OPERATION_NOT_ALLOWED when the transition is not permitted.
 */
export function validateAllocationTransition(current: string, target: string): void {
  const allowed = ALLOCATION_TRANSITIONS[current];
  if (!allowed) {
    throw PlatformError.of(
      ERROR_CODES.OPERATION_NOT_ALLOWED,
      `Unknown allocation status: ${current}.`,
      { details: { current, target } },
    );
  }
  if (!allowed.includes(target)) {
    throw PlatformError.of(
      ERROR_CODES.OPERATION_NOT_ALLOWED,
      `Cannot transition allocation from "${current}" to "${target}".`,
      { details: { current, target } },
    );
  }
}

// ---------------------------------------------------------------------------
// Adjustment validation
// ---------------------------------------------------------------------------

/**
 * Validates that an adjustment reason is a non-empty string.
 * Throws VALIDATION_FAILED when the reason is missing or blank.
 */
export function validateAdjustmentReason(reason: unknown): void {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Adjustment reason is mandatory.', {
      details: { reason },
    });
  }
}

// ---------------------------------------------------------------------------
// FIFO consumption validation
// ---------------------------------------------------------------------------

export interface FIFOConsumptionLayer {
  readonly remainingQuantity: number;
}

/**
 * Validates that enough FIFO layers exist to fulfill the requested consumption
 * quantity. Throws INVENTORY_INSUFFICIENT when total remaining across all
 * layers is less than the requested quantity.
 *
 * Layers should be ordered oldest-first (receivedAt ASC, id ASC) by the
 * caller before passing to this function.
 */
export function validateFIFOConsumption(quantity: number, layers: FIFOConsumptionLayer[]): void {
  validateNonNegativeQuantity(quantity, 'quantity');

  if (quantity === 0) {
    return;
  }

  const totalRemaining = layers.reduce((sum, layer) => sum + layer.remainingQuantity, 0);

  if (totalRemaining < quantity) {
    throw PlatformError.of(
      ERROR_CODES.INVENTORY_INSUFFICIENT,
      `Insufficient FIFO layers: requested ${quantity}, available ${totalRemaining} across ${layers.length} layer(s).`,
      { details: { requested: quantity, available: totalRemaining, layerCount: layers.length } },
    );
  }
}
