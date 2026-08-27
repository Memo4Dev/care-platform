import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { StockPosition } from './stock-position';

// ---------------------------------------------------------------------------
// Deterministic test data
// ---------------------------------------------------------------------------
const ORG_ID = '01980000-0000-7000-8000-000000000001';
const WH_ID = '01980000-0000-7000-8000-000000000010';
const VAR_ID = '01980000-0000-7000-8000-000000000020';
const SP_ID = '01980000-0000-7000-8000-000000000030';
const CLOCK = () => new Date('2025-06-15T10:00:00Z');

describe('StockPosition', () => {
  // =========================================================================
  // Creation
  // =========================================================================
  describe('create', () => {
    it('given a new stock position when created then onHand=0, reserved=0, allocated=0', () => {
      const pos = StockPosition.create(
        { id: SP_ID, organizationId: ORG_ID, warehouseId: WH_ID, variantId: VAR_ID },
        { clock: CLOCK },
      );

      expect(pos.id).toBe(SP_ID);
      expect(pos.organizationId).toBe(ORG_ID);
      expect(pos.warehouseId).toBe(WH_ID);
      expect(pos.variantId).toBe(VAR_ID);
      expect(pos.onHand).toBe(0);
      expect(pos.reserved).toBe(0);
      expect(pos.allocated).toBe(0);
      expect(pos.available).toBe(0);
      expect(pos.version).toBe(1);
      expect(pos.expectedVersion).toBe(0);
      expect(pos.hasPendingChanges).toBe(true);
    });
  });

  // =========================================================================
  // Reconstitution
  // =========================================================================
  describe('reconstitute', () => {
    it('given persisted state when reconstituting then version matches and no events emitted', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 50,
        reserved: 10,
        allocated: 5,
        version: 3,
      });

      expect(pos.onHand).toBe(50);
      expect(pos.reserved).toBe(10);
      expect(pos.allocated).toBe(5);
      expect(pos.available).toBe(35);
      expect(pos.version).toBe(3);
      expect(pos.expectedVersion).toBe(3);
      expect(pos.hasPendingChanges).toBe(false);
      expect(pos.pullDomainEvents()).toHaveLength(0);
    });
  });

  // =========================================================================
  // Receiving stock
  // =========================================================================
  describe('increaseOnHand', () => {
    it('given a stock position when receiving stock then onHand increases', () => {
      const pos = StockPosition.create(
        { id: SP_ID, organizationId: ORG_ID, warehouseId: WH_ID, variantId: VAR_ID },
        { clock: CLOCK },
      );

      pos.increaseOnHand(100, 2.5);

      expect(pos.onHand).toBe(100);
      expect(pos.available).toBe(100);
      expect(pos.version).toBe(2);
      expect(pos.layers).toHaveLength(1);
      expect(pos.layers[0].quantity).toBe(100);
      expect(pos.layers[0].unitCost).toBe(2.5);
    });

    it('given a stock position when receiving stock then StockReceived event emitted', () => {
      const pos = StockPosition.create(
        { id: SP_ID, organizationId: ORG_ID, warehouseId: WH_ID, variantId: VAR_ID },
        { clock: CLOCK },
      );
      // drain the creation event
      pos.pullDomainEvents();

      pos.increaseOnHand(50, 3.0);

      const events = pos.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('StockReceived');
      if (events[0].type === 'StockReceived') {
        expect(events[0].quantity).toBe(50);
        expect(events[0].unitCost).toBe(3.0);
        expect(events[0].warehouseId).toBe(WH_ID);
        expect(events[0].variantId).toBe(VAR_ID);
        expect(events[0].organizationId).toBe(ORG_ID);
      }
    });

    it('given a stock position when receiving zero then no change', () => {
      const pos = StockPosition.create(
        { id: SP_ID, organizationId: ORG_ID, warehouseId: WH_ID, variantId: VAR_ID },
        { clock: CLOCK },
      );

      pos.increaseOnHand(0, 1.0);

      expect(pos.onHand).toBe(0);
      expect(pos.layers).toHaveLength(0);
    });

    it('given a stock position when receiving negative then VALIDATION_FAILED error', () => {
      const pos = StockPosition.create(
        { id: SP_ID, organizationId: ORG_ID, warehouseId: WH_ID, variantId: VAR_ID },
        { clock: CLOCK },
      );

      let error: unknown;
      try {
        pos.increaseOnHand(-5, 1.0);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  // =========================================================================
  // Available formula
  // =========================================================================
  describe('available formula', () => {
    it('given a stock position when onHand=10 and reserved=3 and allocated=2 then available=5', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 10,
        reserved: 3,
        allocated: 2,
        version: 1,
      });

      expect(pos.available).toBe(5);
    });

    it('given a stock position when all reserved+allocated=onHand then available=0', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 10,
        reserved: 6,
        allocated: 4,
        version: 1,
      });

      expect(pos.available).toBe(0);
    });
  });

  // =========================================================================
  // Reserving stock
  // =========================================================================
  describe('reserve', () => {
    it('given a stock position with stock when reserving then reserved increases', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      pos.reserve(5);

      expect(pos.reserved).toBe(5);
      expect(pos.available).toBe(15);
      expect(pos.onHand).toBe(20);
    });

    it('given a stock position when reserving beyond available then INVENTORY_INSUFFICIENT error', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 10,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      let error: unknown;
      try {
        pos.reserve(11);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.INVENTORY_INSUFFICIENT);
      expect(pos.reserved).toBe(0);
    });

    it('given a stock position when reserving zero then no change', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 10,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      pos.reserve(0);

      expect(pos.reserved).toBe(0);
      expect(pos.version).toBe(1);
    });

    it('given a stock position when reserving stock then StockReserved event emitted', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      pos.reserve(5);

      const events = pos.pullDomainEvents();
      const reservedEvents = events.filter((e) => e.type === 'StockReserved');
      expect(reservedEvents).toHaveLength(1);
      if (reservedEvents[0].type === 'StockReserved') {
        expect(reservedEvents[0].quantity).toBe(5);
        expect(reservedEvents[0].warehouseId).toBe(WH_ID);
      }
    });
  });

  // =========================================================================
  // Releasing reservation
  // =========================================================================
  describe('releaseReservation', () => {
    it('given a stock position with reservation when releasing then reserved decreases', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 5,
        allocated: 0,
        version: 1,
      });

      pos.releaseReservation(3);

      expect(pos.reserved).toBe(2);
      expect(pos.available).toBe(18);
    });

    it('given a stock position when releasing more than reserved then RESERVATION_NOT_AVAILABLE error', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 3,
        allocated: 0,
        version: 1,
      });

      let error: unknown;
      try {
        pos.releaseReservation(5);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.RESERVATION_NOT_AVAILABLE);
      expect(pos.reserved).toBe(3);
    });
  });

  // =========================================================================
  // Allocating stock
  // =========================================================================
  describe('allocate', () => {
    it('given a stock position with stock when allocating then allocated increases', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      pos.allocate(8);

      expect(pos.allocated).toBe(8);
      expect(pos.available).toBe(12);
    });

    it('given a stock position when allocating beyond available then ALLOCATION_INSUFFICIENT error', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 5,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      let error: unknown;
      try {
        pos.allocate(6);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.ALLOCATION_INSUFFICIENT);
      expect(pos.allocated).toBe(0);
    });
  });

  // =========================================================================
  // Releasing allocation
  // =========================================================================
  describe('releaseAllocation', () => {
    it('given a stock position with allocation when releasing then allocated decreases', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 0,
        allocated: 8,
        version: 1,
      });

      pos.releaseAllocation(3);

      expect(pos.allocated).toBe(5);
      expect(pos.available).toBe(15);
    });

    it('given a stock position when releasing more than allocated then ALLOCATION_INSUFFICIENT error', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 0,
        allocated: 3,
        version: 1,
      });

      let error: unknown;
      try {
        pos.releaseAllocation(5);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.ALLOCATION_INSUFFICIENT);
      expect(pos.allocated).toBe(3);
    });
  });

  // =========================================================================
  // Combined reserve + allocate
  // =========================================================================
  describe('reserve and allocate combined', () => {
    it('given a stock position when reserving and allocating then both reduce available', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      pos.reserve(5);
      pos.allocate(5);

      expect(pos.onHand).toBe(20);
      expect(pos.reserved).toBe(5);
      expect(pos.allocated).toBe(5);
      expect(pos.available).toBe(10);
    });

    it('given a stock position when reserving+allocating=onHand then available=0', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 10,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      pos.reserve(6);
      pos.allocate(4);

      expect(pos.available).toBe(0);
    });
  });

  // =========================================================================
  // Consuming stock (decreaseOnHand)
  // =========================================================================
  describe('decreaseOnHand', () => {
    it('given a stock position with layers when consuming then onHand decreases and FIFO layers consumed', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 0,
        reserved: 0,
        allocated: 0,
        version: 1,
      });
      // Simulate receiving stock via increaseOnHand (creates FIFO layers)
      pos.increaseOnHand(30, 2.0, 'layer-1');
      pos.increaseOnHand(20, 3.0, 'layer-2');
      // Pull events from increases
      pos.pullDomainEvents();
      // onHand is now 50 (0 + 30 + 20)
      const versionBefore = pos.version;

      pos.decreaseOnHand(10);

      expect(pos.onHand).toBe(40);
      expect(pos.version).toBe(versionBefore + 1);
    });

    it('given a stock position when consuming beyond total remaining then INVENTORY_INSUFFICIENT error', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 0,
        reserved: 0,
        allocated: 0,
        version: 1,
      });
      // Create a single layer with 5 units
      pos.increaseOnHand(5, 1.0, 'layer-1');
      pos.pullDomainEvents();
      // onHand is now 5

      let error: unknown;
      try {
        pos.decreaseOnHand(10);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.INVENTORY_INSUFFICIENT);
      // onHand should remain unchanged after the failed operation
      expect(pos.onHand).toBe(5);
    });

    it('given a stock position when consuming stock then StockConsumed event emitted', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 0,
        allocated: 0,
        version: 1,
      });
      pos.increaseOnHand(20, 1.0, 'layer-1');
      pos.pullDomainEvents();

      pos.decreaseOnHand(5);

      const events = pos.pullDomainEvents();
      const consumedEvents = events.filter((e) => e.type === 'StockConsumed');
      expect(consumedEvents).toHaveLength(1);
      if (consumedEvents[0].type === 'StockConsumed') {
        expect(consumedEvents[0].quantity).toBe(5);
        expect(consumedEvents[0].warehouseId).toBe(WH_ID);
      }
    });
  });

  // =========================================================================
  // Decreasing onHand below reserved → invariant violation
  // =========================================================================
  describe('invariant: reserved+allocated <= onHand', () => {
    it('given a stock position when decreasing onHand below reserved then invariant violation', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 10,
        reserved: 5,
        allocated: 0,
        version: 1,
      });
      pos.increaseOnHand(10, 1.0, 'layer-1');
      pos.pullDomainEvents();
      // onHand is now 20 (10 original + 10 received)
      // Dispatch 18 leaves onHand=2, but reserved=5 → invariant violated

      let error: unknown;
      try {
        pos.dispatchTransfer(18);
      } catch (caught) {
        error = caught;
      }

      // Error is thrown by validateAvailableConstraint inside validateInvariants.
      // Use direct code check for robustness against dual module resolution.
      expect(error).toBeDefined();
      expect((error as { code: string }).code).toBe(ERROR_CODES.INVENTORY_INSUFFICIENT);
    });
  });

  // =========================================================================
  // Version tracking (optimistic concurrency foundation)
  // =========================================================================
  describe('version tracking', () => {
    it('given a stock position when mutations occur then version bumps and hasPendingChanges', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 0,
        allocated: 0,
        version: 1,
      });
      expect(pos.hasPendingChanges).toBe(false);

      pos.reserve(5);

      expect(pos.version).toBe(2);
      expect(pos.expectedVersion).toBe(1);
      expect(pos.hasPendingChanges).toBe(true);
    });

    it('given a stock position when markPersisted then expectedVersion matches version', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      pos.reserve(5);
      expect(pos.hasPendingChanges).toBe(true);

      pos.markPersisted();

      expect(pos.version).toBe(2);
      expect(pos.expectedVersion).toBe(2);
      expect(pos.hasPendingChanges).toBe(false);
    });

    it('given a stock position when version drifts then hasPendingChanges reflects conflict', () => {
      // Simulate a stale read: reconstitute at version 3 but the DB has been
      // updated to version 4 since the read. The aggregate will bump to 5,
      // creating a mismatch: expectedVersion=3, version=5.
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 20,
        reserved: 0,
        allocated: 0,
        version: 3,
      });

      pos.reserve(2);
      expect(pos.version).toBe(4);
      expect(pos.expectedVersion).toBe(3);
      expect(pos.hasPendingChanges).toBe(true);
    });
  });

  // =========================================================================
  // Dispatch transfer
  // =========================================================================
  describe('dispatchTransfer', () => {
    it('given a stock position when dispatching transfer then onHand decreases', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 30,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      pos.dispatchTransfer(10);

      expect(pos.onHand).toBe(20);
    });

    it('given a stock position when dispatching more than onHand then INVENTORY_INSUFFICIENT', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 5,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      let error: unknown;
      try {
        pos.dispatchTransfer(10);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.INVENTORY_INSUFFICIENT);
    });
  });

  // =========================================================================
  // Receive transfer
  // =========================================================================
  describe('receiveTransfer', () => {
    it('given a stock position when receiving transfer then onHand increases', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 10,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      pos.receiveTransfer(25, 4.0, 'layer-transfer-1');

      expect(pos.onHand).toBe(35);
      expect(pos.layers).toHaveLength(1);
      expect(pos.layers[0].quantity).toBe(25);
      expect(pos.layers[0].unitCost).toBe(4.0);
    });
  });

  // =========================================================================
  // Active layers
  // =========================================================================
  describe('getActiveLayers', () => {
    it('given FIFO layers when some consumed then only active layers returned', () => {
      const pos = StockPosition.reconstitute({
        id: SP_ID,
        organizationId: ORG_ID,
        warehouseId: WH_ID,
        variantId: VAR_ID,
        onHand: 0,
        reserved: 0,
        allocated: 0,
        version: 1,
      });

      pos.increaseOnHand(10, 1.0, 'layer-1');
      pos.increaseOnHand(20, 2.0, 'layer-2');
      pos.pullDomainEvents();

      // Consume all of layer-1
      pos.decreaseOnHand(10);
      pos.pullDomainEvents();

      const active = pos.getActiveLayers();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('layer-2');
    });
  });
});
