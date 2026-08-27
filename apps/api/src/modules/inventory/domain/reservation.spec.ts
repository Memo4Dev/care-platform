import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { Reservation } from './reservation';

// ---------------------------------------------------------------------------
// Deterministic test data
// ---------------------------------------------------------------------------
const ORG_ID = '01980000-0000-7000-8000-000000000001';
const SP_ID = '01980000-0000-7000-8000-000000000030';
const RES_ID = '01980000-0000-7000-8000-000000000040';
const CLOCK = () => new Date('2025-06-15T10:00:00Z');

describe('Reservation', () => {
  // =========================================================================
  // Creation
  // =========================================================================
  describe('create', () => {
    it('given a new reservation when created then status=ACTIVE', () => {
      const reservation = Reservation.create(
        {
          id: RES_ID,
          organizationId: ORG_ID,
          stockPositionId: SP_ID,
        },
        { clock: CLOCK },
      );

      expect(reservation.id).toBe(RES_ID);
      expect(reservation.organizationId).toBe(ORG_ID);
      expect(reservation.stockPositionId).toBe(SP_ID);
      expect(reservation.status).toBe('ACTIVE');
      expect(reservation.version).toBe(1);
      expect(reservation.expectedVersion).toBe(0);
      expect(reservation.hasPendingChanges).toBe(true);
      expect(reservation.expiresAt).toBeNull();
      expect(reservation.referenceType).toBeNull();
      expect(reservation.referenceId).toBeNull();
    });

    it('given a reservation with expiresAt when created then expiresAt is set', () => {
      const expiresAt = new Date('2025-06-15T12:00:00Z');
      const reservation = Reservation.create(
        {
          id: RES_ID,
          organizationId: ORG_ID,
          stockPositionId: SP_ID,
          expiresAt,
          referenceType: 'POS_SALE',
          referenceId: 'sale-123',
        },
        { clock: CLOCK },
      );

      expect(reservation.expiresAt).toBe(expiresAt);
      expect(reservation.referenceType).toBe('POS_SALE');
      expect(reservation.referenceId).toBe('sale-123');
    });
  });

  // =========================================================================
  // Reconstitution
  // =========================================================================
  describe('reconstitute', () => {
    it('given persisted state when reconstituting then version matches and no events emitted', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 3,
      });

      expect(reservation.status).toBe('ACTIVE');
      expect(reservation.version).toBe(3);
      expect(reservation.expectedVersion).toBe(3);
      expect(reservation.hasPendingChanges).toBe(false);
      expect(reservation.pullDomainEvents()).toHaveLength(0);
    });
  });

  // =========================================================================
  // Consume
  // =========================================================================
  describe('consumeReservation', () => {
    it('given an ACTIVE reservation when consumed then status=CONSUMED', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      reservation.consumeReservation();

      expect(reservation.status).toBe('CONSUMED');
      expect(reservation.version).toBe(2);
    });

    it('given an ACTIVE reservation when consumed then ReservationConsumed event emitted', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      reservation.consumeReservation();

      const events = reservation.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ReservationConsumed');
      if (events[0].type === 'ReservationConsumed') {
        expect(events[0].aggregateId).toBe(RES_ID);
        expect(events[0].stockPositionId).toBe(SP_ID);
        expect(events[0].organizationId).toBe(ORG_ID);
      }
    });

    it('given a CONSUMED reservation when trying to consume then RESERVATION_ALREADY_CONSUMED error', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'CONSUMED',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 2,
      });

      let error: unknown;
      try {
        reservation.consumeReservation();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.RESERVATION_ALREADY_CONSUMED);
    });

    it('given a RELEASED reservation when trying to consume then RESERVATION_ALREADY_CONSUMED error', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'RELEASED',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 2,
      });

      let error: unknown;
      try {
        reservation.consumeReservation();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.RESERVATION_ALREADY_CONSUMED);
    });

    it('given an expired ACTIVE reservation when trying to consume then RESERVATION_EXPIRED error', () => {
      const pastDate = new Date('2025-06-15T08:00:00Z');
      const clock = () => new Date('2025-06-15T10:00:00Z');
      const reservation = Reservation.reconstitute(
        {
          id: RES_ID,
          organizationId: ORG_ID,
          stockPositionId: SP_ID,
          status: 'ACTIVE',
          expiresAt: pastDate,
          referenceType: null,
          referenceId: null,
          version: 1,
        },
        { clock },
      );

      let error: unknown;
      try {
        reservation.consumeReservation();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.RESERVATION_EXPIRED);
    });
  });

  // =========================================================================
  // Release
  // =========================================================================
  describe('releaseReservation', () => {
    it('given an ACTIVE reservation when released then status=RELEASED', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      reservation.releaseReservation();

      expect(reservation.status).toBe('RELEASED');
      expect(reservation.version).toBe(2);
    });

    it('given an ACTIVE reservation when released then ReservationReleased event emitted', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      reservation.releaseReservation();

      const events = reservation.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ReservationReleased');
    });

    it('given a CONSUMED reservation when trying to release then RESERVATION_NOT_AVAILABLE error', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'CONSUMED',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 2,
      });

      let error: unknown;
      try {
        reservation.releaseReservation();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.RESERVATION_NOT_AVAILABLE);
    });
  });

  // =========================================================================
  // Expire
  // =========================================================================
  describe('expireReservation', () => {
    it('given an ACTIVE reservation when expired then status=EXPIRED', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      reservation.expireReservation();

      expect(reservation.status).toBe('EXPIRED');
      expect(reservation.version).toBe(2);
    });

    it('given an ACTIVE reservation when expired then ReservationExpired event emitted', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      reservation.expireReservation();

      const events = reservation.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ReservationExpired');
    });

    it('given a RELEASED reservation when trying to expire then RESERVATION_NOT_AVAILABLE error', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'RELEASED',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 2,
      });

      let error: unknown;
      try {
        reservation.expireReservation();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.RESERVATION_NOT_AVAILABLE);
    });
  });

  // =========================================================================
  // Expiry check
  // =========================================================================
  describe('isExpired', () => {
    it('given a reservation with expiresAt in the past when checking then isExpired is true', () => {
      const pastDate = new Date('2025-06-15T08:00:00Z');
      const clock = () => new Date('2025-06-15T10:00:00Z');
      const reservation = Reservation.reconstitute(
        {
          id: RES_ID,
          organizationId: ORG_ID,
          stockPositionId: SP_ID,
          status: 'ACTIVE',
          expiresAt: pastDate,
          referenceType: null,
          referenceId: null,
          version: 1,
        },
        { clock },
      );

      expect(reservation.isExpired).toBe(true);
    });

    it('given a reservation with no expiresAt when checking then isExpired is false', () => {
      const clock = () => new Date('2025-06-15T10:00:00Z');
      const reservation = Reservation.reconstitute(
        {
          id: RES_ID,
          organizationId: ORG_ID,
          stockPositionId: SP_ID,
          status: 'ACTIVE',
          expiresAt: null,
          referenceType: null,
          referenceId: null,
          version: 1,
        },
        { clock },
      );

      expect(reservation.isExpired).toBe(false);
    });

    it('given a reservation with expiresAt in the future when checking then isExpired is false', () => {
      const futureDate = new Date('2025-06-15T12:00:00Z');
      const clock = () => new Date('2025-06-15T10:00:00Z');
      const reservation = Reservation.reconstitute(
        {
          id: RES_ID,
          organizationId: ORG_ID,
          stockPositionId: SP_ID,
          status: 'ACTIVE',
          expiresAt: futureDate,
          referenceType: null,
          referenceId: null,
          version: 1,
        },
        { clock },
      );

      expect(reservation.isExpired).toBe(false);
    });
  });

  // =========================================================================
  // Events
  // =========================================================================
  describe('events', () => {
    it('given a reservation when events emitted then correct events produced', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      reservation.consumeReservation();
      const events = reservation.pullDomainEvents();

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ReservationConsumed');
      expect(events[0].occurredAt).toBeInstanceOf(Date);
      expect(events[0].organizationId).toBe(ORG_ID);
      expect(events[0].aggregateId).toBe(RES_ID);
    });

    it('given a reservation when pullDomainEvents then events are drained', () => {
      const reservation = Reservation.reconstitute({
        id: RES_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      reservation.releaseReservation();
      const first = reservation.pullDomainEvents();
      const second = reservation.pullDomainEvents();

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
    });
  });
});
