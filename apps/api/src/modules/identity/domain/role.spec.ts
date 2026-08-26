import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { type PermissionCode } from '@commerce-platform/database';
import { describe, expect, it } from 'vitest';

import { Role } from './role';

const FIXED_NOW = new Date('2026-02-01T09:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198b000-0000-7000-8000-000000000001';
const ROLE_ID = '0198b000-0000-7000-8000-00000000r001';

function makeRole(): Role {
  return Role.create(
    { id: ROLE_ID, organizationId: ORG_ID, code: 'SALES', name: 'Sales' },
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

describe('Role', () => {
  describe('CreateRole', () => {
    it('given valid input when creating then defaults are empty permission set, isSystem false and exactly one RoleCreated event', () => {
      const role = makeRole();

      expect(role.code).toBe('SALES');
      expect(role.name).toBe('Sales');
      expect(role.isSystem).toBe(false);
      expect(role.listPermissionCodes()).toEqual([]);
      expect(role.version).toBe(1);
      expect(role.expectedVersion).toBe(0);

      const events = role.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'RoleCreated',
        occurredAt: FIXED_NOW,
        organizationId: ORG_ID,
        roleId: ROLE_ID,
        code: 'SALES',
        name: 'Sales',
        isSystem: false,
      });
    });

    it('given isSystem true when creating then the flag persists (system templates are ordinary editable rows)', () => {
      const role = Role.create(
        { id: ROLE_ID, organizationId: ORG_ID, code: 'OWNER', name: 'Owner', isSystem: true },
        { clock },
      );
      expect(role.isSystem).toBe(true);
      // DECISION: system templates' permission sets stay editable.
      role.setPermissions(['users.manage']);
      expect(role.listPermissionCodes()).toEqual(['users.manage']);
    });

    it('given an empty code or name when creating then VALIDATION_FAILED is raised', () => {
      let codeError: unknown;
      try {
        Role.create({ id: ROLE_ID, organizationId: ORG_ID, code: '', name: 'X' }, { clock });
      } catch (caught) {
        codeError = caught;
      }
      expectPlatformError(codeError, ERROR_CODES.VALIDATION_FAILED);

      let nameError: unknown;
      try {
        Role.create({ id: ROLE_ID, organizationId: ORG_ID, code: 'X', name: '   ' }, { clock });
      } catch (caught) {
        nameError = caught;
      }
      expectPlatformError(nameError, ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('RenameRole', () => {
    it('given a new name when renaming then name changes with an ID-only event', () => {
      const role = makeRole();
      role.pullDomainEvents();

      role.rename('Senior Sales');

      expect(role.name).toBe('Senior Sales');
      expect(role.pullDomainEvents()).toEqual([
        { type: 'RoleRenamed', occurredAt: FIXED_NOW, organizationId: ORG_ID, roleId: ROLE_ID },
      ]);
    });

    it('given the current name when renaming then OPERATION_NOT_ALLOWED (no silent no-op)', () => {
      const role = makeRole();
      let error: unknown;
      try {
        role.rename('Sales');
      } catch (caught) {
        error = caught;
      }
      expectPlatformError(error, ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given a blank name when renaming then VALIDATION_FAILED', () => {
      const role = makeRole();
      let error: unknown;
      try {
        role.rename(' ');
      } catch (caught) {
        error = caught;
      }
      expectPlatformError(error, ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('SetRolePermissions (replace-set)', () => {
    it('given an initial grant when setting permissions then codes are granted and RolePermissionsChanged carries the full set', () => {
      const role = makeRole();
      role.setPermissions(['sales.create', 'sales.cancel']);

      expect(role.listPermissionCodes()).toEqual(['sales.create', 'sales.cancel']);
      const event = role.pullDomainEvents()[1];
      expect(event).toMatchObject({
        type: 'RolePermissionsChanged',
        organizationId: ORG_ID,
        roleId: ROLE_ID,
        permissionCodes: ['sales.create', 'sales.cancel'],
      });
    });

    it('given existing grants when setting a different set then missing codes are revoked and extra codes added (REPLACE semantics)', () => {
      const role = makeRole();
      role.setPermissions(['sales.create', 'sales.cancel']);
      role.pullDomainEvents();
      // The first grant round is PERSISTED (repository.save does this), so the
      // diff below is computed against committed state, not accumulated deltas.
      role.markPersisted();

      role.setPermissions(['sales.cancel', 'refund.create']);

      expect(role.hasPermissionCode('sales.create')).toBe(false);
      expect(role.hasPermissionCode('sales.cancel')).toBe(true);
      expect(role.hasPermissionCode('refund.create')).toBe(true);

      const changes = role.collectChanges();
      expect(changes.newPermissionCodes).toEqual(['refund.create']);
      expect(changes.removedPermissionCodes).toEqual(['sales.create']);
    });

    it('given duplicate codes in input when setting then duplicates collapse', () => {
      const role = makeRole();
      role.setPermissions(['sales.create', 'sales.create']);
      expect(role.listPermissionCodes()).toEqual(['sales.create']);
    });

    it('given an unchanged set when setting again then the command still emits RolePermissionsChanged (recorded fact: permissions were set)', () => {
      const role = makeRole();
      role.setPermissions(['sales.create']);
      role.pullDomainEvents();
      role.markPersisted(); // first grant round persisted

      role.setPermissions(['sales.create']);

      const events = role.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'RolePermissionsChanged',
        permissionCodes: ['sales.create'],
      });
      // No storage churn for a no-op set.
      expect(role.collectChanges().newPermissionCodes).toHaveLength(0);
      expect(role.collectChanges().removedPermissionCodes).toHaveLength(0);
    });

    it('given a blank entry when setting then VALIDATION_FAILED and nothing changes', () => {
      const role = makeRole();
      let error: unknown;
      try {
        // The runtime guard rejects blanks even though the TS type cannot
        // express them (repository rows are plain strings).
        role.setPermissions(['sales.create', ''] as unknown as PermissionCode[]);
      } catch (caught) {
        error = caught;
      }
      expectPlatformError(error, ERROR_CODES.VALIDATION_FAILED);
      expect(role.listPermissionCodes()).toEqual([]);
    });
  });

  describe('persistence collaboration', () => {
    it('given a reconstituted aggregate when collected then it is clean', () => {
      const role = Role.reconstitute({
        id: ROLE_ID,
        organizationId: ORG_ID,
        code: 'OWNER',
        name: 'Owner',
        isSystem: true,
        version: 3,
        permissionCodes: ['users.manage', 'sales.create'],
      });

      expect(role.hasPendingChanges).toBe(false);
      expect(role.listPermissionCodes()).toEqual(['users.manage', 'sales.create']);
    });

    it('given a mutated aggregate when markPersisted runs then journals clear and versions commit', () => {
      const role = makeRole();
      role.setPermissions(['sales.create']);
      expect(role.hasPendingChanges).toBe(true);

      role.markPersisted();

      expect(role.hasPendingChanges).toBe(false);
      expect(role.expectedVersion).toBe(role.version);
      expect(role.collectChanges().newPermissionCodes).toHaveLength(0);
      expect(role.collectChanges().removedPermissionCodes).toHaveLength(0);
    });
  });
});
