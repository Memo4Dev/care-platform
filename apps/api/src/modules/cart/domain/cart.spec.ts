import { describe, expect, it } from 'vitest';

import { PlatformError } from '@commerce-platform/contracts';

import { Cart } from './cart';

const ids = {
  cart: '01900000-0000-7000-8000-000000000001',
  org: '01900000-0000-7000-8000-000000000002',
  branch: '01900000-0000-7000-8000-000000000003',
  line: '01900000-0000-7000-8000-000000000004',
  variant: '01900000-0000-7000-8000-000000000005',
  unit: '01900000-0000-7000-8000-000000000006',
};

describe('Cart aggregate', () => {
  it('creates an empty POS Draft without an Inventory side effect', () => {
    const cart = Cart.create({
      id: ids.cart,
      organizationId: ids.org,
      branchId: ids.branch,
      clock: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(cart.status).toBe('DRAFT');
    expect(cart.channel).toBe('POS');
    expect(cart.lines).toEqual([]);
    expect(cart.version).toBe(1);
    expect(cart.pullDomainEvents()).toMatchObject([
      { type: 'CartCreated', aggregateId: ids.cart, aggregateVersion: 1 },
    ]);
  });

  it('merges repeated variant/unit additions and advances the version', () => {
    const cart = Cart.create({ id: ids.cart, organizationId: ids.org, branchId: ids.branch });
    cart.pullDomainEvents();

    cart.addLine({ id: ids.line, variantId: ids.variant, unitId: ids.unit, quantity: '0.1' });
    cart.addLine({
      id: '01900000-0000-7000-8000-000000000007',
      variantId: ids.variant,
      unitId: ids.unit,
      quantity: '0.2',
    });

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe('0.30000000');
    expect(cart.version).toBe(3);
  });

  it('requires a positive replacement quantity and an existing line', () => {
    const cart = Cart.create({ id: ids.cart, organizationId: ids.org, branchId: ids.branch });
    cart.pullDomainEvents();
    cart.addLine({ id: ids.line, variantId: ids.variant, unitId: ids.unit, quantity: '1' });

    expect(() => cart.updateLine(ids.line, '0')).toThrow(PlatformError);
    expect(() => cart.removeLine('01900000-0000-7000-8000-000000000008')).toThrow(PlatformError);
  });

  it('rehydrates only supported Draft status', () => {
    expect(() =>
      Cart.reconstitute({
        id: ids.cart,
        organizationId: ids.org,
        branchId: ids.branch,
        channel: 'POS',
        status: 'DRAFT',
        customerId: null,
        lines: [],
        version: 4,
      }),
    ).not.toThrow();
  });
});
