import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

/**
 * Unit conversion logic — a domain service (NOT an aggregate).
 *
 * Unit conversions express how quantities in one unit map to quantities in
 * another. Conversions are stored as rows of (fromUnitId, toUnitId, factor)
 * and can be chained to support transitive conversions (e.g. Box -> Piece
 * via Case).
 *
 * All arithmetic uses string-based numeric factors (matching the Postgres
 * NUMERIC columns) to avoid floating-point rounding.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */

export interface UnitConversion {
  readonly fromUnitId: string;
  readonly toUnitId: string;
  /** Conversion factor as a numeric string (e.g. "12" means 1 Box = 12 Piece). */
  readonly factor: string;
}

/**
 * Convert a quantity from one unit to another using the provided conversion
 * table. Returns the converted quantity as a numeric string.
 *
 * Direct conversions are tried first; then a BFS finds a transitive path.
 * The factor is multiplied through the chain.
 *
 * @throws PlatformError with INVALID_UNIT_CONVERSION when no path exists.
 */
export function convert(
  fromUnitId: string,
  toUnitId: string,
  quantity: string,
  conversions: UnitConversion[],
): string {
  if (fromUnitId === toUnitId) {
    return quantity;
  }

  const path = findConversionPath(fromUnitId, toUnitId, conversions);
  if (path === null) {
    throw PlatformError.of(
      ERROR_CODES.INVALID_UNIT_CONVERSION,
      `No conversion path from unit "${fromUnitId}" to unit "${toUnitId}".`,
      { details: { fromUnitId, toUnitId } },
    );
  }

  let result = parseNumeric(quantity);
  for (const step of path) {
    result = multiplyNumeric(result, parseNumeric(step.factor));
  }
  return result.toFixed(12).replace(/\.?0+$/, '');
}

/**
 * Find a conversion path from `fromUnitId` to `toUnitId` using BFS.
 *
 * Returns the ordered list of conversion steps, or `null` when no path
 * exists. The search is symmetric — if only "A -> B" is stored, "B -> A"
 * is implicitly available via the reciprocal factor.
 */
export function findConversionPath(
  fromUnitId: string,
  toUnitId: string,
  conversions: UnitConversion[],
): UnitConversion[] | null {
  if (fromUnitId === toUnitId) {
    return [];
  }

  // Build adjacency list (bidirectional). Key = unitId, value = list of
  // { targetUnitId, conversion }.
  const adjacency = new Map<string, Array<{ target: string; conversion: UnitConversion }>>();

  for (const conv of conversions) {
    if (!adjacency.has(conv.fromUnitId)) {
      adjacency.set(conv.fromUnitId, []);
    }
    adjacency.get(conv.fromUnitId)!.push({ target: conv.toUnitId, conversion: conv });

    // Add reverse edge with reciprocal factor
    const reciprocalFactor = invertNumeric(conv.factor);
    if (!adjacency.has(conv.toUnitId)) {
      adjacency.set(conv.toUnitId, []);
    }
    adjacency.get(conv.toUnitId)!.push({
      target: conv.fromUnitId,
      conversion: {
        fromUnitId: conv.toUnitId,
        toUnitId: conv.fromUnitId,
        factor: reciprocalFactor,
      },
    });
  }

  // BFS
  const visited = new Set<string>();
  const queue: Array<{ unitId: string; path: UnitConversion[] }> = [
    { unitId: fromUnitId, path: [] },
  ];
  visited.add(fromUnitId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current.unitId) ?? [];

    for (const { target, conversion } of neighbors) {
      if (target === toUnitId) {
        return [...current.path, conversion];
      }
      if (!visited.has(target)) {
        visited.add(target);
        queue.push({ unitId: target, path: [...current.path, conversion] });
      }
    }
  }

  return null;
}

/**
 * Validate a set of conversion definitions for internal consistency.
 * Returns an array of human-readable error strings. An empty array means
 * the conversions are valid.
 *
 * Checks:
 * - No self-referencing conversions (fromUnitId === toUnitId)
 * - No duplicate directed conversions
 * - Factors must be positive numbers
 */
export function validateConversion(conversions: UnitConversion[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const conv of conversions) {
    // Self-reference check
    if (conv.fromUnitId === conv.toUnitId) {
      errors.push(`Self-referencing conversion from unit "${conv.fromUnitId}" to itself.`);
      continue;
    }

    // Factor positivity check
    const factor = parseNumeric(conv.factor);
    if (factor <= 0) {
      errors.push(
        `Conversion factor from "${conv.fromUnitId}" to "${conv.toUnitId}" must be positive, got "${conv.factor}".`,
      );
    }

    // Duplicate directed check
    const key = `${conv.fromUnitId}->${conv.toUnitId}`;
    if (seen.has(key)) {
      errors.push(`Duplicate directed conversion from "${conv.fromUnitId}" to "${conv.toUnitId}".`);
    }
    seen.add(key);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Numeric helpers (string-based, no floats in storage)
// ---------------------------------------------------------------------------

function parseNumeric(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw PlatformError.of(
      ERROR_CODES.INVALID_UNIT_CONVERSION,
      `Invalid numeric value "${value}" in unit conversion.`,
    );
  }
  return n;
}

function multiplyNumeric(a: number, b: number): number {
  return a * b;
}

function invertNumeric(factor: string): string {
  const n = parseNumeric(factor);
  if (n === 0) {
    throw PlatformError.of(
      ERROR_CODES.INVALID_UNIT_CONVERSION,
      'Cannot invert a zero conversion factor.',
    );
  }
  return (1 / n).toFixed(12).replace(/\.?0+$/, '');
}
