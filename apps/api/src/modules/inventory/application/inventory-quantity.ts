import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

/** Exact scale used by Inventory correctness quantities. */
const INVENTORY_QUANTITY_SCALE = 100_000_000n;
const MAX_SCALED_QUANTITY = 10_000_000_000n * INVENTORY_QUANTITY_SCALE - 1n;
const INVENTORY_QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,8})?$/;

interface NormalizeOptions {
  allowZero?: boolean;
}

/**
 * Validate and canonicalize an Inventory quantity without using a JS number.
 * Public values always use exactly eight fractional digits.
 */
export function normalizeInventoryQuantity(value: string, options: NormalizeOptions = {}): string {
  const scaled = parseScaled(value);
  if ((!options.allowZero && scaled === 0n) || scaled > MAX_SCALED_QUANTITY) {
    throw invalidQuantity(value, options.allowZero === true);
  }
  return formatScaled(scaled);
}

/** Add two non-negative Inventory quantities exactly. */
export function addInventoryQuantities(left: string, right: string): string {
  const result = parseScaledAllowZero(left) + parseScaledAllowZero(right);
  if (result > MAX_SCALED_QUANTITY) {
    throw invalidQuantity(`${left} + ${right}`, true);
  }
  return formatScaled(result);
}

/**
 * Subtract two non-negative quantities exactly. A negative result is retained
 * so existing callers can perform their established business-rule check.
 */
export function subtractInventoryQuantities(left: string, right: string): string {
  return formatSignedScaled(parseScaledAllowZero(left) - parseScaledAllowZero(right));
}

/** Compare two non-negative Inventory quantities exactly. */
export function compareInventoryQuantities(left: string, right: string): -1 | 0 | 1 {
  const leftScaled = parseScaledAllowZero(left);
  const rightScaled = parseScaledAllowZero(right);
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

function parseScaledAllowZero(value: string): bigint {
  return parseScaled(normalizeInventoryQuantity(value, { allowZero: true }));
}

function parseScaled(value: string): bigint {
  if (typeof value !== 'string') {
    throw invalidQuantity(value, true);
  }

  const normalized = value.trim();
  if (!INVENTORY_QUANTITY_PATTERN.test(normalized)) {
    throw invalidQuantity(value, true);
  }

  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * INVENTORY_QUANTITY_SCALE + BigInt(fraction.padEnd(8, '0'));
}

function formatScaled(value: bigint): string {
  const whole = value / INVENTORY_QUANTITY_SCALE;
  const fraction = (value % INVENTORY_QUANTITY_SCALE).toString().padStart(8, '0');
  return `${whole}.${fraction}`;
}

function formatSignedScaled(value: bigint): string {
  if (value >= 0n) return formatScaled(value);
  return `-${formatScaled(-value)}`;
}

function invalidQuantity(value: unknown, allowZero: boolean): PlatformError {
  return PlatformError.of(
    ERROR_CODES.VALIDATION_FAILED,
    `Inventory quantity must be ${allowZero ? 'a non-negative' : 'a positive'} decimal with at most 8 fractional digits.`,
    { details: { field: 'quantity', value: String(value) } },
  );
}
