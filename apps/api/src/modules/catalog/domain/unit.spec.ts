import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { UnitDefinition } from './unit';

/** Fixed clock so event timestamps are deterministic in assertions. */
const FIXED_NOW = new Date('2026-01-15T10:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198a000-0000-7000-8000-000000000001';
const UNIT_ID = '0198a000-0000-7000-8000-000000000030';

describe('UnitDefinition', () => {
  describe('CreateUnit', () => {
    it('given a valid name and symbol when creating then unit is created with one UnitCreated event', () => {
      const unit = UnitDefinition.create(
        { id: UNIT_ID, organizationId: ORG_ID, name: 'Piece', symbol: 'pc' },
        { clock },
      );

      expect(unit.id).toBe(UNIT_ID);
      expect(unit.organizationId).toBe(ORG_ID);
      expect(unit.name).toBe('Piece');
      expect(unit.symbol).toBe('pc');
      expect(unit.isBaseUnit).toBe(false);
      expect(unit.version).toBe(1);
      expect(unit.expectedVersion).toBe(0);

      const events = unit.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'UnitCreated',
        occurredAt: FIXED_NOW,
        organizationId: ORG_ID,
        unitId: UNIT_ID,
        name: 'Piece',
        symbol: 'pc',
        isBaseUnit: false,
      });
    });

    it('given a base unit when creating then isBaseUnit is true in the event', () => {
      const unit = UnitDefinition.create(
        { id: UNIT_ID, organizationId: ORG_ID, name: 'Piece', symbol: 'pc', isBaseUnit: true },
        { clock },
      );

      expect(unit.isBaseUnit).toBe(true);
      const events = unit.pullDomainEvents();
      expect(events[0]).toMatchObject({ isBaseUnit: true });
    });

    it('given an empty name when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        UnitDefinition.create(
          { id: UNIT_ID, organizationId: ORG_ID, name: '   ', symbol: 'pc' },
          { clock },
        );
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given an empty symbol when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        UnitDefinition.create(
          { id: UNIT_ID, organizationId: ORG_ID, name: 'Piece', symbol: '   ' },
          { clock },
        );
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given pulled events when pulling again then the aggregate emits each event exactly once', () => {
      const unit = UnitDefinition.create(
        { id: UNIT_ID, organizationId: ORG_ID, name: 'Piece', symbol: 'pc' },
        { clock },
      );
      expect(unit.pullDomainEvents()).toHaveLength(1);
      expect(unit.pullDomainEvents()).toHaveLength(0);
    });
  });

  describe('reconstitution', () => {
    it('given persisted state when reconstituting then version matches and no events are emitted', () => {
      const unit = UnitDefinition.reconstitute({
        id: UNIT_ID,
        organizationId: ORG_ID,
        name: 'Piece',
        symbol: 'pc',
        isBaseUnit: true,
        version: 3,
      });

      expect(unit.id).toBe(UNIT_ID);
      expect(unit.name).toBe('Piece');
      expect(unit.isBaseUnit).toBe(true);
      expect(unit.version).toBe(3);
      expect(unit.expectedVersion).toBe(3);
      expect(unit.hasPendingChanges).toBe(false);
    });
  });

  describe('change journaling', () => {
    it('given markPersisted after a save cycle when inspecting versions then expectedVersion catches up', () => {
      const unit = UnitDefinition.create(
        { id: UNIT_ID, organizationId: ORG_ID, name: 'Piece', symbol: 'pc' },
        { clock },
      );
      unit.pullDomainEvents();

      unit.markPersisted();

      expect(unit.expectedVersion).toBe(1);
      expect(unit.version).toBe(1);
      expect(unit.hasPendingChanges).toBe(false);
    });
  });
});
