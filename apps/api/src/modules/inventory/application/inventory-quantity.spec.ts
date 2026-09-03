import { describe, expect, it } from 'vitest';

import {
  addInventoryQuantities,
  compareInventoryQuantities,
  normalizeInventoryQuantity,
  subtractInventoryQuantities,
} from './inventory-quantity';

describe('Inventory exact quantities', () => {
  it('canonicalizes exact quantities to eight decimal places', () => {
    expect(normalizeInventoryQuantity('1.00000001')).toBe('1.00000001');
    expect(normalizeInventoryQuantity(' 9999999999.99999999 ')).toBe('9999999999.99999999');
  });

  it('rejects zero, excess scale, scientific notation, and JS-number-shaped precision loss', () => {
    expect(() => normalizeInventoryQuantity('0')).toThrow(/positive decimal/);
    expect(() => normalizeInventoryQuantity('1.000000001')).toThrow(/at most 8/);
    expect(() => normalizeInventoryQuantity('1e-8')).toThrow(/at most 8/);
    expect(() => normalizeInventoryQuantity(String(0.1 + 0.2))).toThrow(/at most 8/);
  });

  it('adds, subtracts, and compares without floating point arithmetic', () => {
    expect(addInventoryQuantities('0.10000001', '0.20000002')).toBe('0.30000003');
    expect(subtractInventoryQuantities('1', '0.00000001')).toBe('0.99999999');
    expect(subtractInventoryQuantities('0', '0.00000001')).toBe('-0.00000001');
    expect(compareInventoryQuantities('1.00000000', '0.99999999')).toBe(1);
  });
});
