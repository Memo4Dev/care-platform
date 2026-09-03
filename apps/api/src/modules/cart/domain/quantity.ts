import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

/** Numeric(14,8) quantity precision used by persisted Cart lines. */
const SCALE = 100_000_000n;
const MAX_SCALED = 999_999n * SCALE + (SCALE - 1n);
const QUANTITY_PATTERN = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,8})?$/;

/**
 * Normalize a positive decimal quantity without passing through a JS float.
 * The returned representation is fixed to eight fractional places so domain
 * results and PostgreSQL NUMERIC serialization have one stable wire shape.
 */
export function normalizeQuantity(value: string): string {
  if (typeof value !== 'string') {
    throw invalidQuantity(value);
  }

  const normalized = value.trim();
  if (!QUANTITY_PATTERN.test(normalized)) {
    throw invalidQuantity(value);
  }

  const scaled = toScaled(normalized);
  if (scaled <= 0n || scaled > MAX_SCALED) {
    throw invalidQuantity(value);
  }

  return formatScaled(scaled);
}

/** Add two already validated quantities using integer arithmetic. */
export function addQuantities(left: string, right: string): string {
  const scaled = toScaled(normalizeQuantity(left)) + toScaled(normalizeQuantity(right));
  if (scaled <= 0n || scaled > MAX_SCALED) {
    throw invalidQuantity(`${left} + ${right}`);
  }
  return formatScaled(scaled);
}

function toScaled(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
}

function formatScaled(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(8, '0');
  return `${whole}.${fraction}`;
}

function invalidQuantity(value: unknown): PlatformError {
  return PlatformError.of(
    ERROR_CODES.VALIDATION_FAILED,
    'Cart line quantity must be a positive decimal with at most 8 fractional digits.',
    { details: { field: 'quantity', value: String(value) } },
  );
}
