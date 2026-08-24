import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { User } from './user';

/** Fixed clock so event timestamps are deterministic in assertions. */
const FIXED_NOW = new Date('2026-02-01T09:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198b000-0000-7000-8000-000000000001';
const BRANCH_A = '0198b000-0000-7000-8000-0000000000a1';
const BRANCH_B = '0198b000-0000-7000-8000-0000000000b1';
const ROLE_SALES = '0198b000-0000-7000-8000-0000000000s1';
const ROLE_CASHIER = '0198b000-0000-7000-8000-0000000000c1';
const USER_ID = '0198b000-0000-7000-8000-00000000u001';

function makeUser(): User {
  return User.create(
    {
      id: USER_ID,
      organizationId: ORG_ID,
      email: 'Owner@Care.Test',
      name: 'Ada Owner',
    },
    { clock },
  );
}

function expectPlatformError(
  error: unknown,
  code: string,
): { code: string; details?: Record<string, unknown> } {
  expect(isPlatformError(error)).toBe(true);
  const platformError = error as { code: string; details?: Record<string, unknown> };
  expect(platformError.code).toBe(code);
  return platformError;
}

describe('User', () => {
  describe('CreateUser', () => {
    it('given valid input when creating then email is normalized, status ACTIVE and one UserCreated event is collected', () => {
      const user = makeUser();

      expect(user.email).toBe('owner@care.test'); // lowercase storage convention
      expect(user.status).toBe('ACTIVE');
      expect(user.supabaseUserId).toBeNull();
      // New aggregates are persisted as version 1.
      expect(user.version).toBe(1);
      expect(user.expectedVersion).toBe(0);

      const events = user.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'UserCreated',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          userId: user.id,
          email: 'owner@care.test',
          name: 'Ada Owner',
          status: 'ACTIVE',
        },
      ]);
    });

    it('given pulled events when pulling again then each event is emitted exactly once', () => {
      const user = makeUser();
      expect(user.pullDomainEvents()).toHaveLength(1);
      expect(user.pullDomainEvents()).toHaveLength(0);
    });

    it('given a malformed email when creating then VALIDATION_FAILED is raised and nothing is emitted', () => {
      let error: unknown;
      try {
        User.create(
          { id: 'u1', organizationId: ORG_ID, email: 'not-an-email', name: 'X' },
          { clock },
        );
      } catch (caught) {
        error = caught;
      }
      expectPlatformError(error, ERROR_CODES.VALIDATION_FAILED);

      let whitespaceError: unknown;
      try {
        User.create({ id: 'u1', organizationId: ORG_ID, email: '   ', name: 'X' }, { clock });
      } catch (caught) {
        whitespaceError = caught;
      }
      expectPlatformError(whitespaceError, ERROR_CODES.VALIDATION_FAILED);
    });

    it('given an empty name when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        User.create({ id: 'u1', organizationId: ORG_ID, email: 'a@b.co', name: '  ' }, { clock });
      } catch (caught) {
        error = caught;
      }
      expectPlatformError(error, ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('LinkIdentity', () => {
    it('given an unlinked user when linking then the Supabase identity is stored with an ID-only event', () => {
      const user = makeUser();
      user.pullDomainEvents();

      user.linkIdentity('supabase-abc123');

      expect(user.supabaseUserId).toBe('supabase-abc123');
      expect(user.pullDomainEvents()).toEqual([
        {
          type: 'UserIdentityLinked',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          userId: USER_ID,
        },
      ]);
    });

    it('given an already-linked user when linking again then OPERATION_NOT_ALLOWED even for the same value', () => {
      const user = makeUser();
      user.pullDomainEvents(); // creation event persisted with CreateUser
      user.linkIdentity('supabase-abc123');

      let error: unknown;
      try {
        user.linkIdentity('supabase-abc123');
      } catch (caught) {
        error = caught;
      }

      expectPlatformError(error, ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(user.supabaseUserId).toBe('supabase-abc123');
      // Rejected command changed nothing.
      expect(user.version).toBe(2); // only the successful link bumped
      expect(user.pullDomainEvents()).toEqual([
        {
          type: 'UserIdentityLinked',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          userId: USER_ID,
        },
      ]);
    });

    it('given a blank identity value when linking then VALIDATION_FAILED is raised', () => {
      const user = makeUser();
      let error: unknown;
      try {
        user.linkIdentity('  ');
      } catch (caught) {
        error = caught;
      }
      expectPlatformError(error, ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('Suspend / Reactivate transitions', () => {
    it('given an active user when suspending then status flips and data is retained', () => {
      const user = makeUser();
      user.pullDomainEvents(); // creation event persisted with CreateUser
      user.suspend();
      expect(user.status).toBe('SUSPENDED');
      // Retained data, no deletion command exists.
      expect(user.email).toBe('owner@care.test');
      expect(user.pullDomainEvents()).toEqual([
        { type: 'UserSuspended', occurredAt: FIXED_NOW, organizationId: ORG_ID, userId: USER_ID },
      ]);
    });

    it('given an already-suspended user when suspending again then OPERATION_NOT_ALLOWED', () => {
      const user = makeUser();
      user.suspend();
      let error: unknown;
      try {
        user.suspend();
      } catch (caught) {
        error = caught;
      }
      expectPlatformError(error, ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given a suspended user when reactivating then status flips back to ACTIVE', () => {
      const user = makeUser();
      user.suspend();
      user.reactivate();
      expect(user.status).toBe('ACTIVE');
    });

    it('given an active user when reactivating then OPERATION_NOT_ALLOWED', () => {
      const user = makeUser();
      let error: unknown;
      try {
        user.reactivate();
      } catch (caught) {
        error = caught;
      }
      expectPlatformError(error, ERROR_CODES.OPERATION_NOT_ALLOWED);
    });
  });

  describe('AssignRole / RevokeRole (branch-scoped)', () => {
    it('given a user without presence on the branch when assigning a role then UserRoleAssigned AND BranchAccessGranted fire in order (any role implies access)', () => {
      const user = makeUser();
      user.pullDomainEvents();

      user.assignRole({ roleId: ROLE_SALES, branchId: BRANCH_A });

      expect(user.hasMembership(BRANCH_A, ROLE_SALES)).toBe(true);
      expect(user.hasBranchAccess(BRANCH_A)).toBe(true);
      expect(user.pullDomainEvents()).toEqual([
        {
          type: 'UserRoleAssigned',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          userId: user.id,
          roleId: ROLE_SALES,
          branchId: BRANCH_A,
        },
        {
          type: 'BranchAccessGranted',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          userId: user.id,
          branchId: BRANCH_A,
        },
      ]);
    });

    it('given a user already present on the branch when assigning a second role then only UserRoleAssigned fires', () => {
      const user = makeUser();
      user.assignRole({ roleId: ROLE_SALES, branchId: BRANCH_A });
      user.pullDomainEvents();

      user.assignRole({ roleId: ROLE_CASHIER, branchId: BRANCH_A });

      expect(user.hasMembership(BRANCH_A, ROLE_CASHIER)).toBe(true);
      const events = user.pullDomainEvents();
      expect(events.map((event) => event.type)).toEqual(['UserRoleAssigned']);
    });

    it('given a duplicate membership when assigning again then OPERATION_NOT_ALLOWED and nothing changes', () => {
      const user = makeUser();
      user.assignRole({ roleId: ROLE_SALES, branchId: BRANCH_A });
      user.pullDomainEvents();

      let error: unknown;
      try {
        user.assignRole({ roleId: ROLE_SALES, branchId: BRANCH_A });
      } catch (caught) {
        error = caught;
      }

      const platformError = expectPlatformError(error, ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(platformError.details).toMatchObject({
        userId: user.id,
        roleId: ROLE_SALES,
        branchId: BRANCH_A,
      });
      expect(user.pullDomainEvents()).toHaveLength(0);
    });

    it('given a held membership when revoking then membership drops but branch access SURVIVES (explicit-only removal)', () => {
      const user = makeUser();
      user.assignRole({ roleId: ROLE_SALES, branchId: BRANCH_A });
      user.pullDomainEvents();

      user.revokeRole({ roleId: ROLE_SALES, branchId: BRANCH_A });

      expect(user.hasMembership(BRANCH_A, ROLE_SALES)).toBe(false);
      expect(user.hasBranchAccess(BRANCH_A)).toBe(true);
      expect(user.pullDomainEvents().map((event) => event.type)).toEqual(['UserRoleRevoked']);
    });

    it('given a membership that was assigned but not persisted when revoking it then no insert+delete pair remains', () => {
      const user = makeUser();
      user.assignRole({ roleId: ROLE_SALES, branchId: BRANCH_A });
      user.revokeRole({ roleId: ROLE_SALES, branchId: BRANCH_A });

      const changes = user.collectChanges();
      expect(changes.newMemberships).toHaveLength(0);
      expect(changes.removedMemberships).toHaveLength(0);
    });

    it('given a non-held membership when revoking then OPERATION_NOT_ALLOWED', () => {
      const user = makeUser();
      let error: unknown;
      try {
        user.revokeRole({ roleId: ROLE_SALES, branchId: BRANCH_A });
      } catch (caught) {
        error = caught;
      }
      expectPlatformError(error, ERROR_CODES.OPERATION_NOT_ALLOWED);
    });
  });

  describe('GrantBranchAccess / RevokeBranchAccess', () => {
    it('given a fresh branch when granting access explicitly then access is added with a BranchAccessGranted event (view-only staff)', () => {
      const user = makeUser();
      user.pullDomainEvents(); // creation event persisted with CreateUser
      user.grantBranchAccess(BRANCH_B);

      expect(user.hasBranchAccess(BRANCH_B)).toBe(true);
      expect(user.pullDomainEvents().map((event) => event.type)).toEqual(['BranchAccessGranted']);
    });

    it('given existing access when granting again then OPERATION_NOT_ALLOWED', () => {
      const user = makeUser();
      user.grantBranchAccess(BRANCH_B);
      let error: unknown;
      try {
        user.grantBranchAccess(BRANCH_B);
      } catch (caught) {
        error = caught;
      }
      expectPlatformError(error, ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given roles still held at the branch when revoking access then OPERATION_NOT_ALLOWED (roles must never be stranded without access)', () => {
      const user = makeUser();
      user.assignRole({ roleId: ROLE_SALES, branchId: BRANCH_A });
      user.pullDomainEvents();

      let error: unknown;
      try {
        user.revokeBranchAccess(BRANCH_A);
      } catch (caught) {
        error = caught;
      }

      const platformError = expectPlatformError(error, ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(platformError.details).toMatchObject({
        branchId: BRANCH_A,
        remainingRoleIds: [ROLE_SALES],
      });
      expect(user.hasBranchAccess(BRANCH_A)).toBe(true);
    });

    it('given a branch whose roles were all revoked when revoking access then access drops and BranchAccessRevoked fires', () => {
      const user = makeUser();
      user.assignRole({ roleId: ROLE_SALES, branchId: BRANCH_A });
      user.revokeRole({ roleId: ROLE_SALES, branchId: BRANCH_A });
      user.pullDomainEvents();

      user.revokeBranchAccess(BRANCH_A);

      expect(user.hasBranchAccess(BRANCH_A)).toBe(false);
      expect(user.pullDomainEvents().map((event) => event.type)).toEqual(['BranchAccessRevoked']);
    });

    it('given absent access when revoking then OPERATION_NOT_ALLOWED', () => {
      const user = makeUser();
      let error: unknown;
      try {
        user.revokeBranchAccess(BRANCH_B);
      } catch (caught) {
        error = caught;
      }
      expectPlatformError(error, ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given access revoked in-memory when assigning a role on that branch again then access is re-granted (no stale delete journal)', () => {
      const user = makeUser();
      user.grantBranchAccess(BRANCH_B);
      user.revokeBranchAccess(BRANCH_B);
      user.assignRole({ roleId: ROLE_SALES, branchId: BRANCH_B });

      const changes = user.collectChanges();
      expect(changes.grantedBranchIds).toEqual([BRANCH_B]);
      expect(changes.revokedBranchIds).toHaveLength(0);
      expect(changes.newMemberships).toEqual([{ branchId: BRANCH_B, roleId: ROLE_SALES }]);
    });
  });

  describe('persistence collaboration', () => {
    it('given a reconstituted aggregate when collected then it is clean (no pending changes, no events)', () => {
      const user = User.reconstitute({
        id: '0198b000-0000-7000-8000-00000000u002',
        organizationId: ORG_ID,
        email: 'bob@care.test',
        name: 'Bob',
        supabaseUserId: 'supabase-xyz',
        status: 'ACTIVE',
        version: 4,
        memberships: [{ branchId: BRANCH_A, roleId: ROLE_SALES }],
        branchAccess: [BRANCH_A],
      });

      expect(user.hasPendingChanges).toBe(false);
      expect(user.collectChanges().newMemberships).toHaveLength(0);
      expect(user.collectChanges().grantedBranchIds).toHaveLength(0);
      expect(user.collectChanges().revokedBranchIds).toHaveLength(0);
      expect(user.listMemberships()).toEqual([{ branchId: BRANCH_A, roleId: ROLE_SALES }]);
      expect(user.listBranchAccess()).toEqual([BRANCH_A]);
    });

    it('given a mutated aggregate when markPersisted runs then journals clear and versions commit', () => {
      const user = makeUser();
      user.assignRole({ roleId: ROLE_SALES, branchId: BRANCH_A });
      expect(user.hasPendingChanges).toBe(true);

      user.markPersisted();

      expect(user.hasPendingChanges).toBe(false);
      expect(user.expectedVersion).toBe(user.version);
      expect(user.collectChanges().newMemberships).toHaveLength(0);
    });
  });
});
