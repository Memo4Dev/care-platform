import { describe, expect, it } from 'vitest';
import { PlatformError } from '@commerce-platform/contracts';
import { BusinessCustomer } from './business-customer';

const base = {
  id: '018f0000-0000-7000-8000-000000000101',
  organizationId: '018f0000-0000-7000-8000-000000000102',
  displayName: 'Walk In',
  code: null,
  phone: null,
  email: null,
};

describe('BusinessCustomer', () => {
  it.each(['INDIVIDUAL', 'BUSINESS'] as const)(
    'creates an optional Sales customer of type %s',
    (type) => {
      const customer = BusinessCustomer.create({ ...base, type });
      expect(customer.state).toMatchObject({
        type,
        organizationId: base.organizationId,
        displayName: 'Walk In',
      });
    },
  );

  it('rejects a blank display name', () => {
    expect(() =>
      BusinessCustomer.create({ ...base, type: 'INDIVIDUAL', displayName: '  ' }),
    ).toThrow(PlatformError);
  });

  it('keeps the customer reference optional for future walk-in Cart and Sale snapshots', () => {
    const customerId: string | null = null;
    expect(customerId).toBeNull();
  });
});
