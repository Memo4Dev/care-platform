import { describe, expect, it, vi } from 'vitest';

import { CustomersContractProvider } from './customers-contracts.provider';

describe('CustomersContractProvider', () => {
  it('returns a persistence-independent reference view', async () => {
    const service = {
      get: vi.fn().mockResolvedValue({
        id: 'customer-id',
        organizationId: 'org-id',
        type: 'BUSINESS',
        displayName: 'Acme',
        code: 'ACME-1',
        phone: '+201000000000',
        email: 'private@example.test',
      }),
    };
    const provider = new CustomersContractProvider(service as never);

    await expect(provider.getCustomer('org-id', 'customer-id')).resolves.toEqual({
      id: 'customer-id',
      organizationId: 'org-id',
      type: 'BUSINESS',
      displayName: 'Acme',
      code: 'ACME-1',
    });
  });
});
