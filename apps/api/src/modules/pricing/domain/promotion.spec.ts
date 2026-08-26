import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { Promotion } from './promotion';

/** Fixed clock so event timestamps are deterministic in assertions. */
const FIXED_NOW = new Date('2026-01-15T10:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198a000-0000-7000-8000-000000000001';
const PROMO_ID = '0198a000-0000-7000-8000-000000000060';

describe('Promotion', () => {
  describe('CreatePromotion', () => {
    it('given a valid input when creating then promotion is active and PromotionCreated event is collected', () => {
      const promotion = Promotion.create(
        {
          id: PROMO_ID,
          organizationId: ORG_ID,
          name: '10% Off Analgesics',
          type: 'PERCENTAGE',
          target: 'CATEGORY',
          value: '10',
        },
        { clock },
      );

      expect(promotion.id).toBe(PROMO_ID);
      expect(promotion.name).toBe('10% Off Analgesics');
      expect(promotion.type).toBe('PERCENTAGE');
      expect(promotion.target).toBe('CATEGORY');
      expect(promotion.value).toBe('10');
      expect(promotion.isActive).toBe(true);
      expect(promotion.version).toBe(1);
      expect(promotion.expectedVersion).toBe(0);

      const events = promotion.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'PromotionCreated',
        occurredAt: FIXED_NOW,
        organizationId: ORG_ID,
        promotionId: PROMO_ID,
        name: '10% Off Analgesics',
        promotionType: 'PERCENTAGE',
      });
    });

    it('given an empty name when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        Promotion.create(
          {
            id: PROMO_ID,
            organizationId: ORG_ID,
            name: '   ',
            type: 'PERCENTAGE',
            target: 'CATEGORY',
            value: '10',
          },
          { clock },
        );
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given an empty value when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        Promotion.create(
          {
            id: PROMO_ID,
            organizationId: ORG_ID,
            name: 'Promo',
            type: 'PERCENTAGE',
            target: 'CATEGORY',
            value: '   ',
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

  describe('DeactivatePromotion', () => {
    it('given an active promotion when deactivating then isActive becomes false and PromotionDeactivated is emitted', () => {
      const promotion = Promotion.create(
        {
          id: PROMO_ID,
          organizationId: ORG_ID,
          name: 'Promo',
          type: 'FIXED_AMOUNT',
          target: 'PRODUCT',
          value: '5.00',
        },
        { clock },
      );
      promotion.pullDomainEvents();

      const deactivated = promotion.deactivate();

      expect(deactivated).toBe(true);
      expect(promotion.isActive).toBe(false);
      const events = promotion.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'PromotionDeactivated',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          promotionId: PROMO_ID,
        },
      ]);
    });

    it('given an already-inactive promotion when deactivating again then it is an accepted no-op that emits nothing', () => {
      const promotion = Promotion.create(
        {
          id: PROMO_ID,
          organizationId: ORG_ID,
          name: 'Promo',
          type: 'PERCENTAGE',
          target: 'ORDER',
          value: '10',
        },
        { clock },
      );
      promotion.deactivate();
      promotion.pullDomainEvents();
      promotion.markPersisted();

      const deactivated = promotion.deactivate();

      expect(deactivated).toBe(false);
      expect(promotion.isActive).toBe(false);
      expect(promotion.pullDomainEvents()).toHaveLength(0);
      expect(promotion.hasPendingChanges).toBe(false);
    });
  });

  describe('isValidAt', () => {
    it('given an active promotion within its date window when checking then it is valid', () => {
      const promotion = Promotion.create(
        {
          id: PROMO_ID,
          organizationId: ORG_ID,
          name: 'Promo',
          type: 'PERCENTAGE',
          target: 'ORDER',
          value: '10',
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-12-31T23:59:59.999Z'),
        },
        { clock },
      );

      expect(promotion.isValidAt(new Date('2026-06-15T10:00:00.000Z'))).toBe(true);
    });

    it('given an active promotion before its startDate when checking then it is not valid', () => {
      const promotion = Promotion.create(
        {
          id: PROMO_ID,
          organizationId: ORG_ID,
          name: 'Promo',
          type: 'PERCENTAGE',
          target: 'ORDER',
          value: '10',
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          endDate: null,
        },
        { clock },
      );

      expect(promotion.isValidAt(new Date('2026-06-15T10:00:00.000Z'))).toBe(false);
    });

    it('given an active promotion after its endDate when checking then it is not valid', () => {
      const promotion = Promotion.create(
        {
          id: PROMO_ID,
          organizationId: ORG_ID,
          name: 'Promo',
          type: 'PERCENTAGE',
          target: 'ORDER',
          value: '10',
          startDate: null,
          endDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        { clock },
      );

      expect(promotion.isValidAt(new Date('2026-06-15T10:00:00.000Z'))).toBe(false);
    });

    it('given an inactive promotion when checking then it is not valid regardless of dates', () => {
      const promotion = Promotion.create(
        {
          id: PROMO_ID,
          organizationId: ORG_ID,
          name: 'Promo',
          type: 'PERCENTAGE',
          target: 'ORDER',
          value: '10',
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-12-31T23:59:59.999Z'),
        },
        { clock },
      );
      promotion.deactivate();

      expect(promotion.isValidAt(new Date('2026-06-15T10:00:00.000Z'))).toBe(false);
    });
  });

  describe('reconstitution', () => {
    it('given persisted state when reconstituting then version matches and no events are emitted', () => {
      const promotion = Promotion.reconstitute({
        id: PROMO_ID,
        organizationId: ORG_ID,
        name: 'Promo',
        type: 'PERCENTAGE',
        target: 'ORDER',
        value: '10',
        minQuantity: 3,
        maxQuantity: 10,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T23:59:59.999Z'),
        isActive: true,
        version: 3,
      });

      expect(promotion.id).toBe(PROMO_ID);
      expect(promotion.minQuantity).toBe(3);
      expect(promotion.maxQuantity).toBe(10);
      expect(promotion.version).toBe(3);
      expect(promotion.expectedVersion).toBe(3);
      expect(promotion.hasPendingChanges).toBe(false);
    });
  });
});
