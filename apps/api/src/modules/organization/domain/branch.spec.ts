import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import type { OrganizationDomainEvent } from './events';
import { Organization } from './organization';

const FIXED_NOW = new Date('2026-01-15T10:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198a000-0000-7000-8000-000000000001';
const BRANCH_ID = '0198a000-0000-7000-8000-0000000000a1';
const BRANCH_2_ID = '0198a000-0000-7000-8000-0000000000a2';
const WAREHOUSE_ID = '0198a000-0000-7000-8000-0000000000b1';
const WAREHOUSE_2_ID = '0198a000-0000-7000-8000-0000000000b2';

function organizationWithBranch(): Organization {
  const organization = Organization.create({ id: ORG_ID, name: 'Care Pharmacy Group' }, { clock });
  organization.createBranch({ id: BRANCH_ID, code: 'BR-HLD', name: 'Headquarters Branch' });
  organization.pullDomainEvents();
  return organization;
}

function eventTypes(events: OrganizationDomainEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('Branch commands through the Organization aggregate', () => {
  describe('CreateBranch', () => {
    it('given unique code when creating then branch is active with default priority and BranchCreated is emitted', () => {
      const organization = Organization.create({ id: ORG_ID, name: 'Org' }, { clock });

      organization.createBranch({
        id: BRANCH_ID,
        code: 'BR-HLD',
        name: 'Headquarters Branch',
      });

      const branch = organization.findBranch(BRANCH_ID);
      expect(branch).toBeDefined();
      expect(branch?.isActive).toBe(true);
      expect(branch?.priority).toBe(0);
      expect(branch?.version).toBe(1);

      const events = organization.pullDomainEvents();
      expect(eventTypes(events)).toEqual(['OrganizationCreated', 'BranchCreated']);
      expect(events[1]).toMatchObject({
        organizationId: ORG_ID,
        branchId: BRANCH_ID,
        code: 'BR-HLD',
        priority: 0,
      });
    });

    it('given a duplicate code within the same organization when creating then VALIDATION_FAILED — per-org code uniqueness is an aggregate invariant', () => {
      const organization = organizationWithBranch();

      let error: unknown;
      try {
        organization.createBranch({ id: BRANCH_2_ID, code: 'BR-HLD', name: 'Duplicate' });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      const platformError = error as { code: string; details?: Record<string, unknown> };
      expect(platformError.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(platformError.details).toMatchObject({
        field: 'code',
        code: 'BR-HLD',
        organizationId: ORG_ID,
      });
      // The rejected branch must not exist or emit anything.
      expect(organization.findBranch(BRANCH_2_ID)).toBeUndefined();
      expect(organization.pullDomainEvents()).toHaveLength(0);
    });
  });

  describe('ChangeBranchPriority', () => {
    it('given an existing branch when changing priority then BranchPriorityChanged carries the new value', () => {
      const organization = organizationWithBranch();

      organization.changeBranchPriority({ branchId: BRANCH_ID, priority: 42 });

      expect(organization.findBranch(BRANCH_ID)?.priority).toBe(42);
      const events = organization.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'BranchPriorityChanged',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          branchId: BRANCH_ID,
          priority: 42,
        },
      ]);
    });

    it('given two priority changes before persistence when collecting changes then the branch appears once with the final version', () => {
      const organization = organizationWithBranch();

      organization.changeBranchPriority({ branchId: BRANCH_ID, priority: 5 });
      organization.changeBranchPriority({ branchId: BRANCH_ID, priority: 9 });

      const changed = organization.collectChanges().changedBranches;
      expect(changed).toHaveLength(1);
      // version 3 = creation write + two priority writes; expectedVersion is
      // still 0 because nothing has been persisted in this unit test yet.
      expect(changed[0]).toMatchObject({
        id: BRANCH_ID,
        priority: 9,
        version: 3,
        expectedVersion: 0,
      });

      const events = organization.pullDomainEvents();
      expect(eventTypes(events)).toEqual(['BranchPriorityChanged', 'BranchPriorityChanged']);
    });

    it('given a fractional priority when changing then VALIDATION_FAILED', () => {
      const organization = organizationWithBranch();

      let error: unknown;
      try {
        organization.changeBranchPriority({ branchId: BRANCH_ID, priority: 1.5 });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(organization.pullDomainEvents()).toHaveLength(0);
    });

    it('given a branch of another organization when addressing it then RESOURCE_NOT_FOUND — cross-aggregate references are unaddressable', () => {
      const organization = organizationWithBranch();

      let error: unknown;
      try {
        organization.changeBranchPriority({
          branchId: '0198a000-0000-7000-8000-00000000ffff',
          priority: 1,
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.RESOURCE_NOT_FOUND);
    });
  });

  describe('CreateWarehouse', () => {
    it('given a branch of the same organization when creating then warehouse starts active and WarehouseCreated is emitted', () => {
      const organization = organizationWithBranch();

      organization.createWarehouse({
        id: WAREHOUSE_ID,
        branchId: BRANCH_ID,
        code: 'WH-MAIN',
        name: 'Main Storage',
      });

      const warehouse = organization.findWarehouse(WAREHOUSE_ID);
      expect(warehouse?.isActive).toBe(true);
      expect(warehouse?.branchId).toBe(BRANCH_ID);

      const events = organization.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'WarehouseCreated',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          warehouseId: WAREHOUSE_ID,
          branchId: BRANCH_ID,
          code: 'WH-MAIN',
          name: 'Main Storage',
        },
      ]);
    });

    it('given an unknown branch when creating then RESOURCE_NOT_FOUND — the same-org membership invariant is checked in the domain', () => {
      const organization = organizationWithBranch();

      let error: unknown;
      try {
        organization.createWarehouse({
          id: WAREHOUSE_ID,
          branchId: '0198a000-0000-7000-8000-00000000ffff',
          code: 'WH-X',
          name: 'Ghost Storage',
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.RESOURCE_NOT_FOUND);
      expect(organization.findWarehouse(WAREHOUSE_ID)).toBeUndefined();
      expect(organization.pullDomainEvents()).toHaveLength(0);
    });

    it('given a duplicate warehouse code within one branch when creating then VALIDATION_FAILED; another branch may reuse the code', () => {
      const organization = organizationWithBranch();
      organization.createBranch({ id: BRANCH_2_ID, code: 'BR-2', name: 'Second Branch' });
      organization.createWarehouse({
        id: WAREHOUSE_ID,
        branchId: BRANCH_ID,
        code: 'WH-MAIN',
        name: 'Main Storage',
      });
      organization.pullDomainEvents();

      let error: unknown;
      try {
        organization.createWarehouse({
          id: WAREHOUSE_2_ID,
          branchId: BRANCH_ID,
          code: 'WH-MAIN',
          name: 'Duplicate',
        });
      } catch (caught) {
        error = caught;
      }
      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);

      // Same code on a DIFFERENT branch of the SAME org is allowed.
      organization.createWarehouse({
        id: WAREHOUSE_2_ID,
        branchId: BRANCH_2_ID,
        code: 'WH-MAIN',
        name: 'Other Branch Storage',
      });
      expect(organization.findWarehouse(WAREHOUSE_2_ID)).toBeDefined();
    });
  });

  describe('DeactivateWarehouse', () => {
    it('given the last ACTIVE warehouse of its branch when deactivating then it is allowed and WarehouseDeactivated is emitted (no invented invariant)', () => {
      const organization = organizationWithBranch();
      organization.createWarehouse({
        id: WAREHOUSE_ID,
        branchId: BRANCH_ID,
        code: 'WH-MAIN',
        name: 'Main Storage',
      });
      organization.pullDomainEvents();

      organization.deactivateWarehouse({ warehouseId: WAREHOUSE_ID });

      expect(organization.findWarehouse(WAREHOUSE_ID)?.isActive).toBe(false);
      const events = organization.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'WarehouseDeactivated',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          warehouseId: WAREHOUSE_ID,
          branchId: BRANCH_ID,
        },
      ]);
    });

    it('given an already-inactive warehouse when deactivating again then it is an accepted no-op that emits nothing', () => {
      const organization = organizationWithBranch();
      organization.createWarehouse({
        id: WAREHOUSE_ID,
        branchId: BRANCH_ID,
        code: 'WH-MAIN',
        name: 'Main Storage',
      });
      organization.deactivateWarehouse({ warehouseId: WAREHOUSE_ID });
      // WarehouseCreated + WarehouseDeactivated
      expect(organization.pullDomainEvents()).toHaveLength(2);
      // Simulate the repository's post-save commit so the deactivation above
      // counts as persisted before the repeated command runs.
      organization.markPersisted();

      organization.deactivateWarehouse({ warehouseId: WAREHOUSE_ID });

      expect(organization.pullDomainEvents()).toHaveLength(0);
      expect(organization.collectChanges().changedWarehouses).toHaveLength(0);
      expect(organization.hasPendingChanges).toBe(false);
    });

    it('given an unknown warehouse when deactivating then RESOURCE_NOT_FOUND', () => {
      const organization = organizationWithBranch();

      let error: unknown;
      try {
        organization.deactivateWarehouse({
          warehouseId: '0198a000-0000-7000-8000-00000000ffff',
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.RESOURCE_NOT_FOUND);
    });
  });
});
