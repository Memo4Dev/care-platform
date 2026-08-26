import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import type { DatabaseClient } from '@commerce-platform/database';
import { describe, expect, it } from 'vitest';

import type { AuthorizeCommand } from '../contracts';
import { AuthorizationService } from './authorization.service';

/**
 * Error-mapping contract of {@link AuthorizationService.assertAuthorize}
 * (M1-004): denial reasons map onto exactly PERMISSION_DENIED or
 * BRANCH_ACCESS_DENIED; lookup misses map onto RESOURCE_NOT_FOUND.
 *
 * The pure evaluation truth table lives in domain/authorization/
 * authorize.spec.ts; real-PostgreSQL composition is covered by
 * identity.integration.spec.ts. Here the read-model collaborator is fed
 * canned PROJECTION DATA so every mapping row can be reached deterministically
 * (no DB/concurrency semantics are mocked away).
 */

const ORG_ID = '0198b000-0000-7000-8000-000000000001';
const USER_ID = '0198b000-0000-7000-8000-00000000u001';
const B1 = '0198b000-0000-7000-8000-0000000000b1';
const B2 = '0198b000-0000-7000-8000-0000000000b2';

interface QueryStubState {
  userStatus?: 'ACTIVE' | 'SUSPENDED';
  userFound?: boolean;
  membershipRows?: Array<{ branchId: string; permissionCode: string }>;
  branchScope?: string[];
}

function makeService(state: QueryStubState): AuthorizationService {
  return new AuthorizationService(
    {} as DatabaseClient,
    {
      getUser: async (_executor: unknown, _organizationId: string, userId: string) =>
        state.userFound === false
          ? null
          : { id: userId, organizationId: ORG_ID, status: state.userStatus ?? 'ACTIVE' },
      getMembershipPermissions: async () => state.membershipRows ?? [],
      getEffectiveBranchScope: async () => state.branchScope ?? [],
      getMembershipBranches: async () => state.branchScope ?? [],
    },
    {
      getBranch: async (_organizationId: string, branchId: string) =>
        // Only B1 exists in this organization.
        branchId === B1
          ? {
              id: B1,
              organizationId: ORG_ID,
              code: 'BR-1',
              name: 'Branch One',
              priority: 1,
              isActive: true,
              version: 1,
            }
          : null,
    },
  );
}

function baseCommand(overrides: Partial<AuthorizeCommand> = {}): AuthorizeCommand {
  return {
    userId: USER_ID,
    organizationId: ORG_ID,
    permissionCode: 'sales.create',
    ...overrides,
  };
}

describe('AuthorizationService.assertAuthorize error mapping', () => {
  it('given a holder targeting a branch inside scope when asserting then no error is thrown', async () => {
    const service = makeService({
      membershipRows: [{ branchId: B1, permissionCode: 'sales.create' }],
      branchScope: [B1],
    });

    await expect(service.assertAuthorize(baseCommand({ branchId: B1 }))).resolves.toEqual({
      allowed: true,
      reason: null,
    });
  });

  it('given a missing capability at the target branch when asserting then PERMISSION_DENIED', async () => {
    const service = makeService({ membershipRows: [], branchScope: [B1] });

    let error: unknown;
    try {
      await service.assertAuthorize(baseCommand({ branchId: B1 }));
    } catch (caught) {
      error = caught;
    }

    expect(isPlatformError(error)).toBe(true);
    const platformError = error as { code: string; details?: Record<string, unknown> };
    expect(platformError.code).toBe(ERROR_CODES.PERMISSION_DENIED);
    expect(platformError.details).toMatchObject({
      userId: USER_ID,
      organizationId: ORG_ID,
      permissionCode: 'sales.create',
      reason: 'PERMISSION_NOT_HELD',
      branchId: B1,
    });
  });

  it('given a suspended user when asserting then PERMISSION_DENIED carrying USER_SUSPENDED', async () => {
    const service = makeService({
      userStatus: 'SUSPENDED',
      membershipRows: [{ branchId: B1, permissionCode: 'sales.create' }],
      branchScope: [B1],
    });

    await expect(service.assertAuthorize(baseCommand())).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
      details: expect.objectContaining({ reason: 'USER_SUSPENDED' }),
    });
  });

  it('given an organization-wide action with only a branch membership when asserting then PERMISSION_DENIED', async () => {
    const service = makeService({
      membershipRows: [{ branchId: B1, permissionCode: 'sales.create' }],
      branchScope: [B1],
    });

    await expect(
      service.assertAuthorize(baseCommand({ policyAllows: false })),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PERMISSION_DENIED,
      details: expect.objectContaining({ reason: 'PERMISSION_NOT_HELD' }),
    });
  });

  it('given scope excluding the target despite held membership when asserting then BRANCH_ACCESS_DENIED (defense-in-depth conjunct)', async () => {
    const service = makeService({
      membershipRows: [{ branchId: B1, permissionCode: 'sales.create' }],
      branchScope: [], // explicit access list lost/misconfigured
    });

    await expect(service.assertAuthorize(baseCommand({ branchId: B1 }))).rejects.toMatchObject({
      code: ERROR_CODES.BRANCH_ACCESS_DENIED,
    });
  });

  it('given an unknown user when asserting then RESOURCE_NOT_FOUND', async () => {
    const service = makeService({ userFound: false });
    await expect(service.assertAuthorize(baseCommand())).rejects.toMatchObject({
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
    });
  });

  it('given a branch outside the organization when asserting then RESOURCE_NOT_FOUND before any permission data is considered', async () => {
    const service = makeService({
      membershipRows: [{ branchId: B2, permissionCode: 'sales.create' }],
      branchScope: [B2],
    });

    await expect(service.assertAuthorize(baseCommand({ branchId: B2 }))).rejects.toMatchObject({
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
      details: expect.objectContaining({ branchId: B2 }),
    });
  });

  describe('getEffectivePermissions', () => {
    it('given roles across two branches when queried without a branch then all codes are returned sorted', async () => {
      const service = makeService({
        membershipRows: [
          { branchId: B1, permissionCode: 'refund.create' },
          { branchId: B1, permissionCode: 'sales.create' },
          { branchId: B2, permissionCode: 'inventory.view' },
        ],
        branchScope: [B1, B2],
      });

      await expect(service.getEffectivePermissions(USER_ID, ORG_ID)).resolves.toEqual([
        'inventory.view',
        'refund.create',
        'sales.create',
      ]);
    });
  });
});
