import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { Organization } from './organization';

/** Fixed clock so event timestamps are deterministic in assertions. */
const FIXED_NOW = new Date('2026-01-15T10:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198a000-0000-7000-8000-000000000001';

describe('Organization', () => {
  describe('CreateOrganization', () => {
    it('given a valid name when creating then status is ACTIVE (M1 default) and one OrganizationCreated event is collected', () => {
      const organization = Organization.create(
        { id: ORG_ID, name: 'Care Pharmacy Group' },
        { clock },
      );

      expect(organization.id).toBe(ORG_ID);
      expect(organization.name).toBe('Care Pharmacy Group');
      expect(organization.status).toBe('ACTIVE');
      // New aggregates are persisted as version 1.
      expect(organization.version).toBe(1);
      expect(organization.expectedVersion).toBe(0);

      const events = organization.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'OrganizationCreated',
        occurredAt: FIXED_NOW,
        organizationId: ORG_ID,
        name: 'Care Pharmacy Group',
        status: 'ACTIVE',
      });
    });

    it('given an empty name when creating then VALIDATION_FAILED is raised and nothing is emitted', () => {
      let error: unknown;
      try {
        Organization.create({ id: ORG_ID, name: '   ' }, { clock });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given pulled events when pulling again then the aggregate emits each event exactly once', () => {
      const organization = Organization.create({ id: ORG_ID, name: 'Org' }, { clock });
      expect(organization.pullDomainEvents()).toHaveLength(1);
      expect(organization.pullDomainEvents()).toHaveLength(0);
    });
  });

  describe('ActivateOrganization / SuspendOrganization transitions', () => {
    it('given a suspended organization when activating then status flips to ACTIVE and OrganizationActivated is emitted', () => {
      const organization = Organization.create({ id: ORG_ID, name: 'Org' }, { clock });
      organization.suspend();
      organization.pullDomainEvents();

      organization.activate();

      expect(organization.status).toBe('ACTIVE');
      const events = organization.pullDomainEvents();
      expect(events).toEqual([
        { type: 'OrganizationActivated', occurredAt: FIXED_NOW, organizationId: ORG_ID },
      ]);
    });

    it('given an active organization when suspending then status flips to SUSPENDED and OrganizationSuspended is emitted', () => {
      const organization = Organization.create({ id: ORG_ID, name: 'Org' }, { clock });
      organization.pullDomainEvents();

      organization.suspend();

      expect(organization.status).toBe('SUSPENDED');
      expect(organization.pullDomainEvents()).toEqual([
        { type: 'OrganizationSuspended', occurredAt: FIXED_NOW, organizationId: ORG_ID },
      ]);
    });

    it('given an already-active organization when activating again then OPERATION_NOT_ALLOWED — same-state transitions are errors, not silent no-ops', () => {
      const organization = Organization.create({ id: ORG_ID, name: 'Org' }, { clock });
      organization.pullDomainEvents();

      let error: unknown;
      try {
        organization.activate();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      const platformError = error as { code: string; details?: Record<string, unknown> };
      expect(platformError.code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(platformError.details).toMatchObject({ organizationId: ORG_ID, status: 'ACTIVE' });
      // Nothing changed, nothing recorded.
      expect(organization.status).toBe('ACTIVE');
      expect(organization.pullDomainEvents()).toHaveLength(0);
    });

    it('given an already-suspended organization when suspending again then OPERATION_NOT_ALLOWED — suspension is NOT an idempotent no-op success', () => {
      const organization = Organization.create({ id: ORG_ID, name: 'Org' }, { clock });
      organization.suspend();
      organization.pullDomainEvents();

      let error: unknown;
      try {
        organization.suspend();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      const platformError = error as { code: string; details?: Record<string, unknown> };
      expect(platformError.code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(platformError.details).toMatchObject({ organizationId: ORG_ID, status: 'SUSPENDED' });
      expect(organization.status).toBe('SUSPENDED');
      expect(organization.pullDomainEvents()).toHaveLength(0);
    });
  });

  describe('change journaling', () => {
    it('given a fresh aggregate when collecting changes then root row is marked new with next version 1', () => {
      const organization = Organization.create({ id: ORG_ID, name: 'Org' }, { clock });

      const changes = organization.collectChanges();

      expect(changes.isNew).toBe(true);
      expect(changes.organizationId).toBe(ORG_ID);
      expect(changes.name).toBe('Org');
      expect(changes.status).toBe('ACTIVE');
      expect(changes.expectedVersion).toBe(0);
      expect(changes.nextVersion).toBe(1);
    });

    it('given a rehydrated aggregate with no commands applied when collecting changes then there is nothing to persist', () => {
      const organization = Organization.reconstitute(
        {
          id: ORG_ID,
          name: 'Org',
          status: 'ACTIVE',
          version: 7,
          branches: [],
          warehouses: [],
          policies: [{ policyType: 'OFFLINE', value: { enabled: true }, version: 3 }],
        },
        { clock },
      );

      expect(organization.hasPendingChanges).toBe(false);
      expect(organization.version).toBe(7);
      expect(organization.expectedVersion).toBe(7);
      expect(organization.pullDomainEvents()).toHaveLength(0);

      const changes = organization.collectChanges();
      expect(changes.newBranches).toHaveLength(0);
      expect(changes.changedBranches).toHaveLength(0);
      expect(changes.newWarehouses).toHaveLength(0);
      expect(changes.changedWarehouses).toHaveLength(0);
      expect(changes.newPolicies).toHaveLength(0);
    });

    it('given markPersisted after a save cycle when inspecting versions then expectedVersion catches up and journals clear', () => {
      const organization = Organization.create({ id: ORG_ID, name: 'Org' }, { clock });
      organization.suspend();

      const events = organization.pullDomainEvents();
      expect(events).toHaveLength(2); // created + suspended
      expect(organization.collectChanges().nextVersion).toBe(2);

      organization.markPersisted();

      expect(organization.expectedVersion).toBe(2);
      expect(organization.version).toBe(2);
      expect(organization.hasPendingChanges).toBe(false);
    });

    it('given stored policies when rehydrating then latest values load and the per-org version counter continues after the maximum', () => {
      const organization = Organization.reconstitute(
        {
          id: ORG_ID,
          name: 'Org',
          status: 'ACTIVE',
          version: 4,
          branches: [],
          warehouses: [],
          policies: [
            { policyType: 'RETURN', value: { enabled: true }, version: 5 },
            { policyType: 'RETURN', value: { enabled: false }, version: 9 },
            { policyType: 'CREDIT', value: { enabled: true }, version: 7 },
          ],
        },
        { clock },
      );

      expect(organization.latestPolicy('RETURN')).toEqual({
        value: { enabled: false },
        version: 9,
      });
      expect(organization.latestPolicy('CREDIT')).toEqual({ value: { enabled: true }, version: 7 });

      organization.setPolicy({ policyType: 'DELIVERY', value: { enabled: true } });
      expect(organization.collectChanges().newPolicies).toEqual([
        { policyType: 'DELIVERY', value: { enabled: true }, version: 10 },
      ]);
    });
  });
});
