import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { Coupon } from './coupon';

/** Fixed clock so event timestamps are deterministic in assertions. */
const FIXED_NOW = new Date('2026-01-15T10:00:00.000Z');
const clock = (): Date => new Date(FIXED_NOW);

const ORG_ID = '0198a000-0000-7000-8000-000000000001';
const PROMO_ID = '0198a000-0000-7000-8000-000000000060';
const COUPON_ID = '0198a000-0000-7000-8000-000000000070';

describe('Coupon', () => {
  describe('CreateCoupon', () => {
    it('given a valid code when creating then coupon is active with zero usedCount and CouponCreated event is collected', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
        },
        { clock },
      );

      expect(coupon.id).toBe(COUPON_ID);
      expect(coupon.code).toBe('SAVE10');
      expect(coupon.type).toBe('PERCENTAGE');
      expect(coupon.value).toBe('10');
      expect(coupon.promotionId).toBe(PROMO_ID);
      expect(coupon.usedCount).toBe(0);
      expect(coupon.isActive).toBe(true);
      expect(coupon.version).toBe(1);
      expect(coupon.expectedVersion).toBe(0);

      const events = coupon.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: 'CouponCreated',
        occurredAt: FIXED_NOW,
        organizationId: ORG_ID,
        couponId: COUPON_ID,
        code: 'SAVE10',
      });
    });

    it('given a lowercase code when creating then code is stored uppercase', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'save10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
        },
        { clock },
      );

      expect(coupon.code).toBe('SAVE10');
    });

    it('given an empty code when creating then VALIDATION_FAILED is raised', () => {
      let error: unknown;
      try {
        Coupon.create(
          {
            id: COUPON_ID,
            organizationId: ORG_ID,
            code: '   ',
            type: 'PERCENTAGE',
            value: '10',
            promotionId: PROMO_ID,
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

  describe('RedeemCoupon', () => {
    it('given an active coupon with remaining uses when redeeming then usedCount increments and CouponRedeemed is emitted', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
          maxUses: 5,
        },
        { clock },
      );
      coupon.pullDomainEvents();

      coupon.redeem();

      expect(coupon.usedCount).toBe(1);
      const events = coupon.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'CouponRedeemed',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          couponId: COUPON_ID,
          code: 'SAVE10',
          usedCount: 1,
        },
      ]);
    });

    it('given an inactive coupon when redeeming then COUPON_INVALID is raised', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
        },
        { clock },
      );
      coupon.deactivate();

      let error: unknown;
      try {
        coupon.redeem();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.COUPON_INVALID);
      expect(coupon.usedCount).toBe(0);
    });

    it('given an expired coupon when redeeming then COUPON_EXPIRED is raised', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
          endDate: new Date('2026-01-01T00:00:00.000Z'),
        },
        { clock },
      );

      let error: unknown;
      try {
        coupon.redeem();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.COUPON_EXPIRED);
    });

    it('given a coupon not yet valid when redeeming then COUPON_EXPIRED is raised', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
          startDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        { clock },
      );

      let error: unknown;
      try {
        coupon.redeem();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.COUPON_EXPIRED);
    });

    it('given a coupon that has reached maxUses when redeeming then COUPON_INVALID is raised', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
          maxUses: 2,
        },
        { clock },
      );
      coupon.redeem();
      coupon.redeem();
      coupon.pullDomainEvents();

      let error: unknown;
      try {
        coupon.redeem();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.COUPON_INVALID);
      expect(coupon.usedCount).toBe(2);
    });

    it('given multiple successful redemptions when inspecting usedCount then it matches the number of calls', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
          maxUses: 3,
        },
        { clock },
      );
      coupon.pullDomainEvents();

      coupon.redeem();
      coupon.redeem();

      expect(coupon.usedCount).toBe(2);
    });
  });

  describe('DeactivateCoupon', () => {
    it('given an active coupon when deactivating then isActive becomes false and CouponDeactivated is emitted', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
        },
        { clock },
      );
      coupon.pullDomainEvents();

      const deactivated = coupon.deactivate();

      expect(deactivated).toBe(true);
      expect(coupon.isActive).toBe(false);
      const events = coupon.pullDomainEvents();
      expect(events).toEqual([
        {
          type: 'CouponDeactivated',
          occurredAt: FIXED_NOW,
          organizationId: ORG_ID,
          couponId: COUPON_ID,
          code: 'SAVE10',
        },
      ]);
    });

    it('given an already-inactive coupon when deactivating again then it is an accepted no-op that emits nothing', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
        },
        { clock },
      );
      coupon.deactivate();
      coupon.pullDomainEvents();
      coupon.markPersisted();

      const deactivated = coupon.deactivate();

      expect(deactivated).toBe(false);
      expect(coupon.isActive).toBe(false);
      expect(coupon.pullDomainEvents()).toHaveLength(0);
      expect(coupon.hasPendingChanges).toBe(false);
    });
  });

  describe('isValid', () => {
    it('given an active coupon within its date window and under maxUses when checking then it is valid', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
          maxUses: 10,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-12-31T23:59:59.999Z'),
        },
        { clock },
      );

      expect(coupon.isValid()).toBe(true);
    });

    it('given an inactive coupon when checking then it is not valid', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
        },
        { clock },
      );
      coupon.deactivate();

      expect(coupon.isValid()).toBe(false);
    });

    it('given an expired coupon when checking then it is not valid', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
          endDate: new Date('2026-01-01T00:00:00.000Z'),
        },
        { clock },
      );

      expect(coupon.isValid()).toBe(false);
    });

    it('given a coupon at maxUses when checking then it is not valid', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
          maxUses: 1,
        },
        { clock },
      );
      coupon.redeem();

      expect(coupon.isValid()).toBe(false);
    });
  });

  describe('change journaling', () => {
    it('given markPersisted after a save cycle when inspecting versions then expectedVersion catches up', () => {
      const coupon = Coupon.create(
        {
          id: COUPON_ID,
          organizationId: ORG_ID,
          code: 'SAVE10',
          type: 'PERCENTAGE',
          value: '10',
          promotionId: PROMO_ID,
        },
        { clock },
      );
      coupon.redeem();
      coupon.pullDomainEvents();

      coupon.markPersisted();

      expect(coupon.expectedVersion).toBe(2);
      expect(coupon.version).toBe(2);
      expect(coupon.hasPendingChanges).toBe(false);
    });
  });
});
