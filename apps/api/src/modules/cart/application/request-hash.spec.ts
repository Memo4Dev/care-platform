import { describe, expect, it } from 'vitest';

import { requestHash } from './cart.service';

describe('Cart requestHash', () => {
  it('canonicalizes nested object key order while preserving array order', () => {
    const first = {
      cartId: 'cart-1',
      options: { expectedVersion: 7, quantity: '2.5' },
      items: [
        { unitId: 'unit-1', variantId: 'variant-1' },
        { unitId: 'unit-2', variantId: 'variant-2' },
      ],
    };
    const reordered = {
      items: [
        { variantId: 'variant-1', unitId: 'unit-1' },
        { variantId: 'variant-2', unitId: 'unit-2' },
      ],
      options: { quantity: '2.5', expectedVersion: 7 },
      cartId: 'cart-1',
    };

    expect(requestHash(first)).toBe(requestHash(reordered));
    expect(requestHash({ ...first, items: [...first.items].reverse() })).not.toBe(
      requestHash(first),
    );
  });

  it('keeps the expected Cart version in item mutation fingerprints', () => {
    const itemRequest = {
      cartId: 'cart-1',
      itemId: 'item-1',
      quantity: '2.5',
      expectedVersion: 7,
    };

    expect(requestHash(itemRequest)).not.toBe(requestHash({ ...itemRequest, expectedVersion: 8 }));
  });
});
