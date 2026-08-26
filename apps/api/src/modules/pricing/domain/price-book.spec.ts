import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { PriceBook } from './price-book';

/** Fixed clock so event timestamps are deterministic in assertions. */
const FIXED_NOW = new Date('2026-01-15T10:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198a000-0000-7000-8000-000000000001';
const PRICE_BOOK_ID = '0198a000-0000-7000-8000-000000000040';

describe('PriceBook', () => {
  describe('CreatePriceBook', () => {
    it('given a valid name when creating then price book is active and PriceBookCreated event is collected', () => {
      const priceBook = PriceBook.create(
        { id: PRICE_BOOK_ID, organizationId: ORG_ID, name: 'Retail' },
        { clock },
      );

      expect(priceBook.id).toBe(PRICE_BOOK_ID);
      expect(priceBook.name).toBe('Retail');
      expect(priceBook.isDefault).toBe(false);
      expect(priceBook.isActive).toBe(true);
      expect(priceBook.version).toBe(1);
      expect(priceBook.expectedVersion).toBe(0);

      const events = priceBook.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'PriceBookCreated',
        occurredAt: FIXED_NOW,
        organizationId: ORG_ID,
        priceBookId: PRICE_BOOK_ID,
        name: 'Retail',
        isDefault: false,
      });
    });

    it('given isDefault=true when creating then the event reflects default status', () => {
      const priceBook = PriceBook.create(
        { id: PRICE_BOOK_ID, organizationId: ORG_ID, name: 'Default', isDefault: true },
        { clock },
      );

      expect(priceBook.isDefault).toBe(true);
      const events = priceBook.pullDomainEvents();
      expect(events[0]).toMatchObject({ isDefault: true });
    });

    it('given an empty name when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        PriceBook.create({ id: PRICE_BOOK_ID, organizationId: ORG_ID, name: '   ' }, { clock });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  describe('SetDefaultPriceBook', () => {
    it('given a non-default price book when setting as default then isDefault becomes true and PriceBookDefaultChanged is emitted', () => {
      const priceBook = PriceBook.create(
        { id: PRICE_BOOK_ID, organizationId: ORG_ID, name: 'Retail' },
        { clock },
      );
      priceBook.pullDomainEvents();

      priceBook.setDefault();

      expect(priceBook.isDefault).toBe(true);
      const events = priceBook.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'PriceBookDefaultChanged',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          priceBookId: PRICE_BOOK_ID,
          previousPriceBookId: null,
        },
      ]);
    });

    it('given an already-default price book when setting as default again then OPERATION_NOT_ALLOWED', () => {
      const priceBook = PriceBook.create(
        { id: PRICE_BOOK_ID, organizationId: ORG_ID, name: 'Default', isDefault: true },
        { clock },
      );

      let error: unknown;
      try {
        priceBook.setDefault();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
      expect(priceBook.isDefault).toBe(true);
    });
  });

  describe('DeactivatePriceBook', () => {
    it('given an active price book when deactivating then isActive becomes false and PriceBookDeactivated is emitted', () => {
      const priceBook = PriceBook.create(
        { id: PRICE_BOOK_ID, organizationId: ORG_ID, name: 'Retail' },
        { clock },
      );
      priceBook.pullDomainEvents();

      const deactivated = priceBook.deactivate();

      expect(deactivated).toBe(true);
      expect(priceBook.isActive).toBe(false);
      const events = priceBook.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'PriceBookDeactivated',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          priceBookId: PRICE_BOOK_ID,
        },
      ]);
    });

    it('given an already-inactive price book when deactivating again then it is an accepted no-op that emits nothing', () => {
      const priceBook = PriceBook.create(
        { id: PRICE_BOOK_ID, organizationId: ORG_ID, name: 'Retail' },
        { clock },
      );
      priceBook.deactivate();
      priceBook.pullDomainEvents();
      priceBook.markPersisted();

      const deactivated = priceBook.deactivate();

      expect(deactivated).toBe(false);
      expect(priceBook.isActive).toBe(false);
      expect(priceBook.pullDomainEvents()).toHaveLength(0);
      expect(priceBook.hasPendingChanges).toBe(false);
    });
  });

  describe('clearDefault', () => {
    it('given a default price book when clearing default then isDefault becomes false without emitting an event', () => {
      const priceBook = PriceBook.create(
        { id: PRICE_BOOK_ID, organizationId: ORG_ID, name: 'Default', isDefault: true },
        { clock },
      );
      priceBook.pullDomainEvents();

      priceBook.clearDefault();

      expect(priceBook.isDefault).toBe(false);
      expect(priceBook.pullDomainEvents()).toHaveLength(0);
    });

    it('given a non-default price book when clearing default then nothing changes', () => {
      const priceBook = PriceBook.create(
        { id: PRICE_BOOK_ID, organizationId: ORG_ID, name: 'Retail' },
        { clock },
      );
      priceBook.pullDomainEvents();
      priceBook.markPersisted();

      priceBook.clearDefault();

      expect(priceBook.isDefault).toBe(false);
      expect(priceBook.hasPendingChanges).toBe(false);
    });
  });

  describe('change journaling', () => {
    it('given markPersisted after a save cycle when inspecting versions then expectedVersion catches up', () => {
      const priceBook = PriceBook.create(
        { id: PRICE_BOOK_ID, organizationId: ORG_ID, name: 'Retail' },
        { clock },
      );
      priceBook.deactivate();
      priceBook.pullDomainEvents();

      priceBook.markPersisted();

      expect(priceBook.expectedVersion).toBe(2);
      expect(priceBook.version).toBe(2);
      expect(priceBook.hasPendingChanges).toBe(false);
    });
  });
});
