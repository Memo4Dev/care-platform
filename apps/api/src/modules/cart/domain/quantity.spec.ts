import { describe, expect, it } from 'vitest';

import { PlatformError } from '@commerce-platform/contracts';

import { addQuantities, normalizeQuantity } from './quantity';

describe('Cart quantity', () => {
  it('normalizes decimal strings without using floating point arithmetic', () => {
    expect(normalizeQuantity(' 12.3 ')).toBe('12.30000000');
    expect(addQuantities('0.1', '0.2')).toBe('0.30000000');
  });

  it.each(['0', '0.00000000', '-1', '1.123456789', '1000000', '1e2', ''])(
    'rejects invalid quantity %j',
    (value) => {
      expect(() => normalizeQuantity(value)).toThrow(PlatformError);
    },
  );
});
