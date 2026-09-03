import { describe, expect, it } from 'vitest';

import { CART_QUANTITY_REQUEST_SCHEMA, CART_QUANTITY_RESPONSE_SCHEMA } from './cart-pos.controller';
import { isCartView, normalizeCartView } from './contracts';

describe('Cart OpenAPI quantity schemas', () => {
  it('documents bounded positive decimal request quantities', () => {
    const pattern = new RegExp(CART_QUANTITY_REQUEST_SCHEMA.pattern);

    expect(pattern.test('2.50000000')).toBe(true);
    expect(pattern.test('3')).toBe(true);
    expect(pattern.test('999999.99999999')).toBe(true);
    expect(pattern.test('0.00000001')).toBe(true);
    expect(pattern.test('0')).toBe(false);
    expect(pattern.test('0.00000000')).toBe(false);
    expect(pattern.test('1000000')).toBe(false);
    expect(pattern.test('1.123456789')).toBe(false);
    expect(CART_QUANTITY_REQUEST_SCHEMA).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 15,
    });
  });

  it('accepts canonical emitted quantities, including whole-number values', () => {
    const pattern = new RegExp(CART_QUANTITY_RESPONSE_SCHEMA.pattern);

    expect(pattern.test('2.50000000')).toBe(true);
    expect(pattern.test('3.00000000')).toBe(true);
    expect(pattern.test('999999.99999999')).toBe(true);
    expect(pattern.test('1')).toBe(false);
    expect(pattern.test('1.000000000')).toBe(false);
    expect(pattern.test('1000000.00000000')).toBe(false);
    expect(CART_QUANTITY_RESPONSE_SCHEMA).toMatchObject({
      type: 'string',
      minLength: 10,
      maxLength: 15,
    });
  });
});

describe('Cart public DTO', () => {
  const cart = {
    id: '01900000-0000-7000-8000-000000000001',
    organizationId: '01900000-0000-7000-8000-000000000002',
    branchId: '01900000-0000-7000-8000-000000000003',
    channel: 'POS',
    status: 'DRAFT',
    customerId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    hold: null,
    items: [
      {
        id: '01900000-0000-7000-8000-000000000004',
        organizationId: '01900000-0000-7000-8000-000000000002',
        cartId: '01900000-0000-7000-8000-000000000001',
        variantId: '01900000-0000-7000-8000-000000000005',
        unitId: '01900000-0000-7000-8000-000000000006',
        quantity: '1.00000000',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };

  it('accepts and normalizes the canonical items shape', () => {
    expect(isCartView(cart)).toBe(true);
    expect(normalizeCartView(cart)).toEqual(cart);
  });

  it('rejects the obsolete public lines shape', () => {
    const { items, ...withoutItems } = cart;
    expect(isCartView({ ...withoutItems, lines: items })).toBe(false);
  });
});
