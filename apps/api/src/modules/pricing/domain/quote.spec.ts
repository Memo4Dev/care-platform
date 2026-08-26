import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { type PriceEntryRecord, type PriceQuoteInput, resolvePriceQuote } from './quote';

const VARIANT_ID = '0198a000-0000-7000-8000-0000000000a1';
const UNIT_ID = '0198a000-0000-7000-8000-000000000030';
const BRANCH_ID = '0198a000-0000-7000-8000-0000000000a1';
const OTHER_BRANCH_ID = '0198a000-0000-7000-8000-00000000ffff';

const EFFECTIVE_DATE = new Date('2026-06-15T10:00:00.000Z');

function baseInput(overrides?: Partial<PriceQuoteInput>): PriceQuoteInput {
  return {
    variantId: VARIANT_ID,
    unitId: UNIT_ID,
    priceType: 'CASH',
    channel: 'POS',
    effectiveDate: EFFECTIVE_DATE,
    ...overrides,
  };
}

describe('resolvePriceQuote', () => {
  describe('basic resolution', () => {
    it('given a matching org-wide entry when resolving then the amount is returned with source ORGANIZATIONAL', () => {
      const entries: PriceEntryRecord[] = [
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          branchId: null,
          amount: '15.50',
          effectiveFrom: null,
          effectiveTo: null,
        },
      ];

      const quote = resolvePriceQuote(baseInput(), entries);

      expect(quote).toEqual({
        amount: '15.50',
        priceType: 'CASH',
        channel: 'POS',
        source: 'ORGANIZATIONAL',
      });
    });

    it('given a matching branch-specific entry when resolving then the amount is returned with source BRANCH', () => {
      const entries: PriceEntryRecord[] = [
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          branchId: BRANCH_ID,
          amount: '20.00',
          effectiveFrom: null,
          effectiveTo: null,
        },
      ];

      const quote = resolvePriceQuote(baseInput({ branchId: BRANCH_ID }), entries);

      expect(quote).toEqual({
        amount: '20.00',
        priceType: 'CASH',
        channel: 'POS',
        source: 'BRANCH',
      });
    });

    it('given no matching entries when resolving then PRICE_NOT_AVAILABLE is thrown', () => {
      let error: unknown;
      try {
        resolvePriceQuote(baseInput(), []);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.PRICE_NOT_AVAILABLE);
    });
  });

  describe('branch precedence', () => {
    it('given both branch-specific and org-wide entries when resolving for a branch then branch-specific takes precedence', () => {
      const entries: PriceEntryRecord[] = [
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          branchId: null,
          amount: '15.50',
          effectiveFrom: null,
          effectiveTo: null,
        },
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          branchId: BRANCH_ID,
          amount: '20.00',
          effectiveFrom: null,
          effectiveTo: null,
        },
      ];

      const quote = resolvePriceQuote(baseInput({ branchId: BRANCH_ID }), entries);

      expect(quote.amount).toBe('20.00');
      expect(quote.source).toBe('BRANCH');
    });

    it('given only org-wide entries when resolving for a branch then org-wide is returned', () => {
      const entries: PriceEntryRecord[] = [
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          branchId: null,
          amount: '15.50',
          effectiveFrom: null,
          effectiveTo: null,
        },
      ];

      const quote = resolvePriceQuote(baseInput({ branchId: BRANCH_ID }), entries);

      expect(quote.amount).toBe('15.50');
      expect(quote.source).toBe('ORGANIZATIONAL');
    });

    it('given only entries for a different branch when resolving then PRICE_NOT_AVAILABLE is thrown', () => {
      const entries: PriceEntryRecord[] = [
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          branchId: OTHER_BRANCH_ID,
          amount: '20.00',
          effectiveFrom: null,
          effectiveTo: null,
        },
      ];

      let error: unknown;
      try {
        resolvePriceQuote(baseInput({ branchId: BRANCH_ID }), entries);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.PRICE_NOT_AVAILABLE);
    });
  });

  describe('effective date filtering', () => {
    it('given an entry effective at the date when resolving then the entry is returned', () => {
      const entries: PriceEntryRecord[] = [
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          branchId: null,
          amount: '15.50',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          effectiveTo: new Date('2026-12-31T00:00:00.000Z'),
        },
      ];

      const quote = resolvePriceQuote(baseInput(), entries);

      expect(quote.amount).toBe('15.50');
    });

    it('given an entry not yet effective when resolving then PRICE_NOT_AVAILABLE is thrown', () => {
      const entries: PriceEntryRecord[] = [
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          branchId: null,
          amount: '15.50',
          effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
          effectiveTo: null,
        },
      ];

      let error: unknown;
      try {
        resolvePriceQuote(baseInput(), entries);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.PRICE_NOT_AVAILABLE);
    });

    it('given an entry whose effectiveTo has passed when resolving then PRICE_NOT_AVAILABLE is thrown', () => {
      const entries: PriceEntryRecord[] = [
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          branchId: null,
          amount: '15.50',
          effectiveFrom: null,
          effectiveTo: new Date('2026-01-01T00:00:00.000Z'),
        },
      ];

      let error: unknown;
      try {
        resolvePriceQuote(baseInput(), entries);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.PRICE_NOT_AVAILABLE);
    });
  });

  describe('filtering by price type and channel', () => {
    it('given entries for different price types when resolving for a specific type then only matching entries are considered', () => {
      const entries: PriceEntryRecord[] = [
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'WHOLESALE',
          channel: 'POS',
          branchId: null,
          amount: '10.00',
          effectiveFrom: null,
          effectiveTo: null,
        },
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          branchId: null,
          amount: '15.50',
          effectiveFrom: null,
          effectiveTo: null,
        },
      ];

      const quote = resolvePriceQuote(baseInput({ priceType: 'CASH' }), entries);

      expect(quote.amount).toBe('15.50');
      expect(quote.priceType).toBe('CASH');
    });

    it('given entries for different channels when resolving for a specific channel then only matching entries are considered', () => {
      const entries: PriceEntryRecord[] = [
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'ONLINE',
          branchId: null,
          amount: '18.00',
          effectiveFrom: null,
          effectiveTo: null,
        },
        {
          variantId: VARIANT_ID,
          unitId: UNIT_ID,
          priceType: 'CASH',
          channel: 'POS',
          branchId: null,
          amount: '15.50',
          effectiveFrom: null,
          effectiveTo: null,
        },
      ];

      const quote = resolvePriceQuote(baseInput({ channel: 'ONLINE' }), entries);

      expect(quote.amount).toBe('18.00');
      expect(quote.channel).toBe('ONLINE');
    });
  });
});
