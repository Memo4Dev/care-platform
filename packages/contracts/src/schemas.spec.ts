import { describe, expect, it } from 'vitest';

import {
  branchIdSchema,
  moneyAmountSchema,
  organizationIdSchema,
  positiveIntSchema,
  timestampSchema,
  uuidSchema,
  warehouseIdSchema,
} from './schemas';

const UUID = '018f6b2e-1c3d-7a4e-9f2b-3d5c8a7e6b1f';
const OTHER_UUID = '018f6b2e-1c3d-7a4e-9f2b-3d5c8a7e6b20';

describe('identifier schemas', () => {
  it('accepts UUID strings and rejects everything else', () => {
    expect(uuidSchema.parse(UUID)).toBe(UUID);
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(uuidSchema.safeParse(123).success).toBe(false);
    expect(uuidSchema.safeParse(null).success).toBe(false);
  });

  it('validates org/branch/warehouse ids as uuids', () => {
    for (const schema of [organizationIdSchema, branchIdSchema, warehouseIdSchema]) {
      expect(schema.parse(UUID)).toBe(UUID);
      expect(schema.safeParse('nope').success).toBe(false);
    }
  });

  it('accepts positive integers only', () => {
    expect(positiveIntSchema.parse(1)).toBe(1);
    expect(positiveIntSchema.safeParse(0).success).toBe(false);
    expect(positiveIntSchema.safeParse(-3).success).toBe(false);
    expect(positiveIntSchema.safeParse(1.5).success).toBe(false);
    // Numbers-as-strings are rejected: callers coerce explicitly.
    expect(positiveIntSchema.safeParse('3').success).toBe(false);
  });
});

describe('moneyAmountSchema', () => {
  it.each(['1250.5000', '10', '0', '0.00000001', '-45.50', '99999999999999999'])(
    'accepts decimal string %s',
    (amount) => {
      expect(moneyAmountSchema.parse(amount)).toBe(amount);
    },
  );

  it('rejects floats-as-numbers: money is numeric-string, never float', () => {
    expect(moneyAmountSchema.safeParse(1250.5).success).toBe(false);
    expect(moneyAmountSchema.safeParse(10).success).toBe(false);
    expect(moneyAmountSchema.safeParse(-45.5).success).toBe(false);
  });

  it('rejects exponent notation, separators and malformed strings', () => {
    expect(moneyAmountSchema.safeParse('1e5').success).toBe(false);
    expect(moneyAmountSchema.safeParse('12,500.00').success).toBe(false);
    expect(moneyAmountSchema.safeParse('').success).toBe(false);
    expect(moneyAmountSchema.safeParse('12.').success).toBe(false);
    expect(moneyAmountSchema.safeParse('.50').success).toBe(false);
    expect(moneyAmountSchema.safeParse('+5').success).toBe(false);
    expect(moneyAmountSchema.safeParse('abc').success).toBe(false);
  });
});

describe('timestampSchema', () => {
  it('accepts canonical UTC ISO 8601 timestamps', () => {
    expect(timestampSchema.parse('2026-08-24T12:30:00Z')).toBe('2026-08-24T12:30:00Z');
    expect(timestampSchema.parse('2026-08-24T12:30:00.123Z')).toBe(
      '2026-08-24T12:30:00.123Z',
    );
  });

  it('rejects non-canonical forms so ordering stays deterministic', () => {
    expect(timestampSchema.safeParse('2026-08-24T12:30:00+02:00').success).toBe(false);
    expect(timestampSchema.safeParse('2026-08-24').success).toBe(false);
    expect(timestampSchema.safeParse('yesterday').success).toBe(false);
  });
});

describe('uuid uniqueness helper values', () => {
  it('keeps test fixtures distinct', () => {
    expect(UUID).not.toBe(OTHER_UUID);
  });
});
