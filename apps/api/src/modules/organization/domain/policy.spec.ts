import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { POLICY_TYPES as DB_POLICY_TYPES } from '@commerce-platform/database';
import { describe, expect, it } from 'vitest';

import type { OrganizationDomainEvent } from './events';
import { Organization } from './organization';
import { DEFAULT_POLICY_VALUES, POLICY_TYPES, assertPolicyValue, isPolicyType } from './policy';

const FIXED_NOW = new Date('2026-01-15T10:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198a000-0000-7000-8000-000000000001';

function organization(): Organization {
  return Organization.create({ id: ORG_ID, name: 'Org' }, { clock });
}

function policyEvents(events: OrganizationDomainEvent[]): Array<{
  policyType: string;
  policyVersion: number;
  value: unknown;
}> {
  return events
    .filter(
      (event): event is Extract<OrganizationDomainEvent, { type: 'OrganizationPolicyChanged' }> =>
        event.type === 'OrganizationPolicyChanged',
    )
    .map(({ policyType, policyVersion, value }) => ({ policyType, policyVersion, value }));
}

describe('Organization policies', () => {
  it('given the domain policy list when compared with the persistence enum then both stay identical (drift guard)', () => {
    expect(POLICY_TYPES).toEqual(DB_POLICY_TYPES);
    expect(Object.keys(DEFAULT_POLICY_VALUES).sort()).toEqual([...POLICY_TYPES].sort());
  });

  describe('SetPolicy', () => {
    it('given the first policy of an organization when setting then it gets version 1 and one immutable history entry + OrganizationPolicyChanged', () => {
      const org = organization();

      org.setPolicy({ policyType: 'RETURN', value: { enabled: true, windowDays: 14 } });

      expect(org.latestPolicy('RETURN')).toEqual({
        value: { enabled: true, windowDays: 14 },
        version: 1,
      });

      const changes = org.collectChanges().newPolicies;
      expect(changes).toEqual([
        { policyType: 'RETURN', value: { enabled: true, windowDays: 14 }, version: 1 },
      ]);

      const events = org.pullDomainEvents();
      expect(policyEvents(events)).toEqual([
        {
          policyType: 'RETURN',
          policyVersion: 1,
          value: { enabled: true, windowDays: 14 },
        },
      ]);
    });

    it('given successive changes across DIFFERENT policy types when setting then versions increase per ORGANIZATION, not per policy type', () => {
      const org = organization();

      org.setPolicy({ policyType: 'RETURN', value: { enabled: true } });
      org.setPolicy({ policyType: 'CREDIT', value: { enabled: false, limitAmount: '5000' } });
      org.setPolicy({ policyType: 'RETURN', value: { enabled: false } });

      // RETURN history: v1 then v3; CREDIT at v2 — one shared per-org sequence.
      expect(org.latestPolicy('RETURN')).toEqual({ value: { enabled: false }, version: 3 });
      expect(org.latestPolicy('CREDIT')).toEqual({
        value: { enabled: false, limitAmount: '5000' },
        version: 2,
      });

      const pending = org.collectChanges().newPolicies;
      expect(pending.map((entry) => entry.version)).toEqual([1, 2, 3]);
      expect(policyEvents(org.pullDomainEvents()).map((event) => event.policyVersion)).toEqual([
        1, 2, 3,
      ]);
    });

    it('given a re-set policy when inspecting collectChanges then BOTH history rows are pending inserts — nothing is rewritten in place', () => {
      const org = organization();

      org.setPolicy({ policyType: 'OFFLINE', value: { enabled: true } });
      org.setPolicy({ policyType: 'OFFLINE', value: { enabled: false } });

      const pending = org.collectChanges().newPolicies;
      expect(pending).toHaveLength(2);
      expect(pending[0]).toMatchObject({ policyType: 'OFFLINE', version: 1 });
      expect(pending[1]).toMatchObject({ policyType: 'OFFLINE', version: 2 });
    });

    it('accepts only bounded whole-minute CART hold TTL policy values', () => {
      const org = organization();

      org.setPolicy({ policyType: 'CART', value: { holdReservationTtlMinutes: 30 } });

      expect(org.latestPolicy('CART')).toEqual({
        value: { holdReservationTtlMinutes: 30 },
        version: 1,
      });
      for (const value of [
        {},
        { holdReservationTtlMinutes: 0 },
        { holdReservationTtlMinutes: 1441 },
        { holdReservationTtlMinutes: 1.5 },
        { holdReservationTtlMinutes: '15' },
        { holdReservationTtlMinutes: 15, enabled: true },
      ]) {
        expect(() => org.setPolicy({ policyType: 'CART', value })).toThrowError(
          expect.objectContaining({ code: ERROR_CODES.VALIDATION_FAILED }),
        );
      }
    });

    it('given an unknown policy type when setting then VALIDATION_FAILED', () => {
      const org = organization();
      org.pullDomainEvents(); // discard the OrganizationCreated event

      let error: unknown;
      try {
        org.setPolicy({
          policyType: 'TELEPORT' as never,
          value: { enabled: true },
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(org.pullDomainEvents()).toHaveLength(0);
    });

    it.each([
      ['null', null],
      ['array', [{ enabled: true }]],
      ['string', '"enabled"'],
      ['number', 7],
    ])('given a non-object payload (%s) when setting then VALIDATION_FAILED', (_label, payload) => {
      const org = organization();

      let error: unknown;
      try {
        org.setPolicy({ policyType: 'RETURN', value: payload as never });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('policy helpers', () => {
    it('isPolicyType narrows only catalog members', () => {
      expect(isPolicyType('RETURN')).toBe(true);
      expect(isPolicyType('INVENTORY')).toBe(true);
      expect(isPolicyType('return')).toBe(false);
      expect(isPolicyType(null)).toBe(false);
    });

    it('assertPolicyValue rejects non-plain-object payloads', () => {
      expect(() => assertPolicyValue({ enabled: true })).not.toThrow();
      expect(() => assertPolicyValue(undefined)).toThrow();
      expect(() => assertPolicyValue([])).toThrow();
    });
  });
});
