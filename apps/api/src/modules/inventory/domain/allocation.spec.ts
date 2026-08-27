import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { Allocation } from './allocation';

// ---------------------------------------------------------------------------
// Deterministic test data
// ---------------------------------------------------------------------------
const ORG_ID = '01980000-0000-7000-8000-000000000001';
const SP_ID = '01980000-0000-7000-8000-000000000030';
const ALLOC_ID = '01980000-0000-7000-8000-000000000050';
const CLOCK = () => new Date('2025-06-15T10:00:00Z');

describe('Allocation', () => {
  // =========================================================================
  // Creation
  // =========================================================================
  describe('create', () => {
    it('given a new allocation when created then status=ACTIVE and AllocationCreated event emitted', () => {
      const allocation = Allocation.create(
        {
          id: ALLOC_ID,
          organizationId: ORG_ID,
          stockPositionId: SP_ID,
        },
        { clock: CLOCK },
      );

      expect(allocation.id).toBe(ALLOC_ID);
      expect(allocation.organizationId).toBe(ORG_ID);
      expect(allocation.stockPositionId).toBe(SP_ID);
      expect(allocation.status).toBe('ACTIVE');
      expect(allocation.version).toBe(1);
      expect(allocation.expectedVersion).toBe(0);
      expect(allocation.hasPendingChanges).toBe(true);
      expect(allocation.expiresAt).toBeNull();
      expect(allocation.referenceType).toBeNull();
      expect(allocation.referenceId).toBeNull();

      const events = allocation.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('AllocationCreated');
    });

    it('given a new allocation with optional fields when created then fields are set', () => {
      const expiresAt = new Date('2025-06-20T10:00:00Z');
      const allocation = Allocation.create(
        {
          id: ALLOC_ID,
          organizationId: ORG_ID,
          stockPositionId: SP_ID,
          expiresAt,
          referenceType: 'ORDER',
          referenceId: 'order-456',
        },
        { clock: CLOCK },
      );

      expect(allocation.expiresAt).toBe(expiresAt);
      expect(allocation.referenceType).toBe('ORDER');
      expect(allocation.referenceId).toBe('order-456');
    });
  });

  // =========================================================================
  // Reconstitution
  // =========================================================================
  describe('reconstitute', () => {
    it('given persisted state when reconstituting then version matches and no events emitted', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 3,
      });

      expect(allocation.status).toBe('ACTIVE');
      expect(allocation.version).toBe(3);
      expect(allocation.expectedVersion).toBe(3);
      expect(allocation.hasPendingChanges).toBe(false);
      expect(allocation.pullDomainEvents()).toHaveLength(0);
    });
  });

  // =========================================================================
  // Consume
  // =========================================================================
  describe('consumeAllocation', () => {
    it('given an ACTIVE allocation when consumed then status=CONSUMED', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      allocation.consumeAllocation();

      expect(allocation.status).toBe('CONSUMED');
      expect(allocation.version).toBe(2);
    });

    it('given an ACTIVE allocation when consumed then AllocationConsumed event emitted', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      allocation.consumeAllocation();

      const events = allocation.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('AllocationConsumed');
      if (events[0].type === 'AllocationConsumed') {
        expect(events[0].aggregateId).toBe(ALLOC_ID);
        expect(events[0].stockPositionId).toBe(SP_ID);
        expect(events[0].organizationId).toBe(ORG_ID);
      }
    });

    it('given a CONSUMED allocation when trying to consume then ALLOCATION_INSUFFICIENT error', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
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
        allocation.consumeAllocation();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.ALLOCATION_INSUFFICIENT);
    });

    it('given a RELEASED allocation when trying to consume then ALLOCATION_INSUFFICIENT error', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
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
        allocation.consumeAllocation();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.ALLOCATION_INSUFFICIENT);
    });

    it('given an expired ACTIVE allocation when trying to consume then RESERVATION_EXPIRED error', () => {
      const pastDate = new Date('2025-06-15T08:00:00Z');
      const clock = () => new Date('2025-06-15T10:00:00Z');
      const allocation = Allocation.reconstitute(
        {
          id: ALLOC_ID,
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
        allocation.consumeAllocation();
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
  describe('releaseAllocation', () => {
    it('given an ACTIVE allocation when released then status=RELEASED', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      allocation.releaseAllocation();

      expect(allocation.status).toBe('RELEASED');
      expect(allocation.version).toBe(2);
    });

    it('given an ACTIVE allocation when released then AllocationReleased event emitted', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      allocation.releaseAllocation();

      const events = allocation.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('AllocationReleased');
    });

    it('given a CONSUMED allocation when trying to release then ALLOCATION_INSUFFICIENT error', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
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
        allocation.releaseAllocation();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.ALLOCATION_INSUFFICIENT);
    });
  });

  // =========================================================================
  // Expire
  // =========================================================================
  describe('expireAllocation', () => {
    it('given an ACTIVE allocation when expired then status=EXPIRED', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      allocation.expireAllocation();

      expect(allocation.status).toBe('EXPIRED');
      expect(allocation.version).toBe(2);
    });

    it('given an ACTIVE allocation when expired then AllocationExpired event emitted', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      allocation.expireAllocation();

      const events = allocation.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('AllocationExpired');
    });

    it('given a RELEASED allocation when trying to expire then ALLOCATION_INSUFFICIENT error', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
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
        allocation.expireAllocation();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.ALLOCATION_INSUFFICIENT);
    });
  });

  // =========================================================================
  // Expiry check
  // =========================================================================
  describe('isExpired', () => {
    it('given an allocation with expiresAt in the past when checking then isExpired is true', () => {
      const pastDate = new Date('2025-06-15T08:00:00Z');
      const clock = () => new Date('2025-06-15T10:00:00Z');
      const allocation = Allocation.reconstitute(
        {
          id: ALLOC_ID,
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

      expect(allocation.isExpired).toBe(true);
    });

    it('given an allocation with no expiresAt when checking then isExpired is false', () => {
      const clock = () => new Date('2025-06-15T10:00:00Z');
      const allocation = Allocation.reconstitute(
        {
          id: ALLOC_ID,
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

      expect(allocation.isExpired).toBe(false);
    });
  });

  // =========================================================================
  // Events
  // =========================================================================
  describe('events', () => {
    it('given an allocation when pullDomainEvents then events are drained', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      allocation.releaseAllocation();
      const first = allocation.pullDomainEvents();
      const second = allocation.pullDomainEvents();

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(0);
    });

    it('given an allocation when consumed then event has correct metadata', () => {
      const allocation = Allocation.reconstitute({
        id: ALLOC_ID,
        organizationId: ORG_ID,
        stockPositionId: SP_ID,
        status: 'ACTIVE',
        expiresAt: null,
        referenceType: null,
        referenceId: null,
        version: 1,
      });

      allocation.consumeAllocation();
      const events = allocation.pullDomainEvents();

      expect(events[0].occurredAt).toBeInstanceOf(Date);
      expect(events[0].organizationId).toBe(ORG_ID);
      expect(events[0].aggregateId).toBe(ALLOC_ID);
    });
  });
});
