import { describe, expect, it } from 'vitest';

import { mapPersistenceError } from './persistence-error';

describe('customer persistence errors', () => {
  it('maps a wrapped duplicate customer code to VALIDATION_FAILED', () => {
    const cause = { code: '23505', constraint: 'business_customers_org_code_unique' };
    const result = mapPersistenceError({ cause });

    expect(result).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { constraint: 'business_customers_org_code_unique', field: 'code' },
    });
  });

  it('preserves unexpected persistence errors', () => {
    const error = new Error('database unavailable');

    expect(mapPersistenceError(error)).toBe(error);
  });
});
