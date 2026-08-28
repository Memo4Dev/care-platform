import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedRequest } from '../../common/auth/http-auth.guards';
import {
  trustPrincipal,
  type OrganizationUserPrincipal,
} from '../../common/auth/authenticated-principal';
import type { IdentityContracts } from '../identity/contracts';
import { CartPosController } from './cart-pos.controller';
import type { CartService } from './application/cart.service';

describe('CartPosController create', () => {
  it('hashes the canonical execution input for omitted and null customer IDs', async () => {
    const create = vi.fn().mockResolvedValue({});
    const authorize = vi.fn().mockResolvedValue({ allowed: true });
    const controller = new CartPosController(
      { create } as unknown as CartService,
      { authorize } as unknown as IdentityContracts,
    );
    const principal = trustPrincipal({
      type: 'ORGANIZATION_USER',
      subjectId: 'subject-1',
      organizationUserId: 'user-1',
      organizationId: 'organization-1',
    } as OrganizationUserPrincipal);
    const request = (): AuthenticatedRequest => ({
      headers: { 'idempotency-key': 'cart-create-key' },
      principal,
      correlationId: 'correlation-1',
    });
    const branchId = '01900000-0000-7000-8000-000000000003';

    await controller.create(request(), { branchId });
    await controller.create(request(), { branchId, customerId: null });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0]).toEqual({
      organizationId: 'organization-1',
      branchId,
      customerId: null,
    });
    expect(create.mock.calls[1]?.[0]).toEqual(create.mock.calls[0]?.[0]);
    expect((create.mock.calls[1]?.[1] as { requestHash: string }).requestHash).toBe(
      (create.mock.calls[0]?.[1] as { requestHash: string }).requestHash,
    );
  });

  it('rejects a caller-shaped organization principal that was not server-resolved', async () => {
    const controller = new CartPosController(
      { create: vi.fn() } as unknown as CartService,
      { authorize: vi.fn() } as unknown as IdentityContracts,
    );
    const request: AuthenticatedRequest = {
      headers: { 'idempotency-key': 'cart-create-key' },
      principal: {
        type: 'ORGANIZATION_USER',
        subjectId: 'subject-1',
        organizationUserId: 'user-1',
        organizationId: 'organization-1',
      } as unknown as OrganizationUserPrincipal,
    };

    await expect(
      controller.create(request, { branchId: '01900000-0000-7000-8000-000000000003' }),
    ).rejects.toThrow('Trusted authenticated principal required.');
  });
});
