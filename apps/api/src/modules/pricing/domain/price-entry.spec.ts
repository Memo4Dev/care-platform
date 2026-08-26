import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { PriceEntry } from './price-entry';

/** Fixed clock so event timestamps are deterministic in assertions. */
const FIXED_NOW = new Date('2026-01-15T10:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198a000-0000-7000-8000-000000000001';
const PRICE_BOOK_ID = '0198a000-0000-7000-8000-000000000040';
const VARIANT_ID = '0198a000-0000-7000-8000-0000000000a1';
const UNIT_ID = '0198a000-0000-7000-8000-000000000030';
const ENTRY_ID = '0198a000-0000-7000-8000-000000000050';

describe('PriceEntry', () => {
  describe('CreatePriceEntry', () => {
    it('given valid input when creating then entry is created with one PriceEntryCreated event', () => {
      const entry = PriceEntry.create(
        {
          id: ENTRY_ID,
          organizationId: ORG_ID,
          priceBookId: PRICE_BOOK_ID,
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          amount: '15.50',
        },
        { clock },
      );

      expect(entry.id).toBe(ENTRY_ID);
      expect(entry.priceBookId).toBe(PRICE_BOOK_ID);
      expect(entry.variantId).toBe(VARIANT_ID);
      expect(entry.unitId).toBe(UNIT_ID);
      expect(entry.priceType).toBe('CASH');
      expect(entry.channel).toBe('POS');
      expect(entry.branchId).toBeNull();
      expect(entry.amount).toBe('15.50');
      expect(entry.effectiveFrom).toBeNull();
      expect(entry.effectiveTo).toBeNull();
      expect(entry.version).toBe(1);
      expect(entry.expectedVersion).toBe(0);

      const events = entry.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'PriceEntryCreated',
        occurredAt: FIXED_NOW,
        organizationId: ORG_ID,
        priceEntryId: ENTRY_ID,
        priceBookId: PRICE_BOOK_ID,
        variantId: VARIANT_ID,
        amount: '15.50',
      });
    });

    it('given a zero amount when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        PriceEntry.create(
          {
            id: ENTRY_ID,
            organizationId: ORG_ID,
            priceBookId: PRICE_BOOK_ID,
            variantId: VARIANT_ID,
            unitId: UNIT_ID,
            priceType: 'CASH',
            channel: 'POS',
            amount: '0',
          },
          { clock },
        );
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given a negative amount when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        PriceEntry.create(
          {
            id: ENTRY_ID,
            organizationId: ORG_ID,
            priceBookId: PRICE_BOOK_ID,
            variantId: VARIANT_ID,
            unitId: UNIT_ID,
            priceType: 'CASH',
            channel: 'POS',
            amount: '-5.00',
          },
          { clock },
        );
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given effectiveFrom >= effectiveTo when creating then VALIDATION_FAILED is raised', () => {
      const from = new Date('2026-06-01T00:00:00.000Z');
      const to = new Date('2026-01-01T00:00:00.000Z');

      let error: unknown;
      try {
        PriceEntry.create(
          {
            id: ENTRY_ID,
            organizationId: ORG_ID,
            priceBookId: PRICE_BOOK_ID,
            variantId: VARIANT_ID,
            unitId: UNIT_ID,
            priceType: 'CASH',
            channel: 'POS',
            amount: '10.00',
            effectiveFrom: from,
            effectiveTo: to,
          },
          { clock },
        );
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('UpdatePriceEntry', () => {
    it('given an existing entry when updating amount then amount changes and PriceEntryUpdated is emitted', () => {
      const entry = PriceEntry.create(
        {
          id: ENTRY_ID,
          organizationId: ORG_ID,
          priceBookId: PRICE_BOOK_ID,
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          amount: '10.00',
        },
        { clock },
      );
      entry.pullDomainEvents();

      entry.update({ amount: '20.00' });

      expect(entry.amount).toBe('20.00');
      const events = entry.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'PriceEntryUpdated',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          priceEntryId: ENTRY_ID,
          priceBookId: PRICE_BOOK_ID,
          variantId: VARIANT_ID,
          amount: '20.00',
        },
      ]);
    });

    it('given an invalid amount when updating then VALIDATION_FAILED is raised', () => {
      const entry = PriceEntry.create(
        {
          id: ENTRY_ID,
          organizationId: ORG_ID,
          priceBookId: PRICE_BOOK_ID,
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          amount: '10.00',
        },
        { clock },
      );

      let error: unknown;
      try {
        entry.update({ amount: '-5.00' });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('isEffectiveAt', () => {
    it('given no effective dates when checking then entry is always effective', () => {
      const entry = PriceEntry.create(
        {
          id: ENTRY_ID,
          organizationId: ORG_ID,
          priceBookId: PRICE_BOOK_ID,
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          amount: '10.00',
        },
        { clock },
      );

      expect(entry.isEffectiveAt(new Date('2020-01-01T00:00:00.000Z'))).toBe(true);
      expect(entry.isEffectiveAt(new Date('2030-12-31T23:59:59.999Z'))).toBe(true);
    });

    it('given effectiveFrom set when checking before then entry is not effective', () => {
      const entry = PriceEntry.create(
        {
          id: ENTRY_ID,
          organizationId: ORG_ID,
          priceBookId: PRICE_BOOK_ID,
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          amount: '10.00',
          effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        },
        { clock },
      );

      expect(entry.isEffectiveAt(new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
      expect(entry.isEffectiveAt(new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
      expect(entry.isEffectiveAt(new Date('2026-12-31T00:00:00.000Z'))).toBe(true);
    });

    it('given effectiveTo set when checking at or after then entry is not effective', () => {
      const entry = PriceEntry.create(
        {
          id: ENTRY_ID,
          organizationId: ORG_ID,
          priceBookId: PRICE_BOOK_ID,
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          amount: '10.00',
          effectiveTo: new Date('2026-12-31T00:00:00.000Z'),
        },
        { clock },
      );

      expect(entry.isEffectiveAt(new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
      expect(entry.isEffectiveAt(new Date('2026-12-30T23:59:59.999Z'))).toBe(true);
      expect(entry.isEffectiveAt(new Date('2026-12-31T00:00:00.000Z'))).toBe(false);
    });
  });

  describe('reconstitution', () => {
    it('given persisted state when reconstituting then version matches and no events are emitted', () => {
      const entry = PriceEntry.reconstitute({
        id: ENTRY_ID,
        organizationId: ORG_ID,
        priceBookId: PRICE_BOOK_ID,
        variantId: VARIANT_ID,
        unitId: UNIT_ID,
        priceType: 'CASH',
        channel: 'POS',
        branchId: null,
        amount: '10.00',
        effectiveFrom: null,
        effectiveTo: null,
        version: 4,
      });

      expect(entry.id).toBe(ENTRY_ID);
      expect(entry.amount).toBe('10.00');
      expect(entry.version).toBe(4);
      expect(entry.expectedVersion).toBe(4);
      expect(entry.hasPendingChanges).toBe(false);
    });
  });
});
