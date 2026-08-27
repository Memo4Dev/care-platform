import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { StockTransfer } from './stock-transfer';

// ---------------------------------------------------------------------------
// Deterministic test data
// ---------------------------------------------------------------------------
const ORG_ID = '01980000-0000-7000-8000-000000000001';
const WH_SRC = '01980000-0000-7000-8000-000000000010';
const WH_DST = '01980000-0000-7000-8000-000000000011';
const TF_ID = '01980000-0000-7000-8000-000000000060';
const CLOCK = () => new Date('2025-06-15T10:00:00Z');

describe('StockTransfer', () => {
  // =========================================================================
  // Creation
  // =========================================================================
  describe('create', () => {
    it('given a new transfer when created then status=DRAFT', () => {
      const transfer = StockTransfer.create(
        {
          id: TF_ID,
          organizationId: ORG_ID,
          sourceWarehouseId: WH_SRC,
          destinationWarehouseId: WH_DST,
        },
        { clock: CLOCK },
      );

      expect(transfer.id).toBe(TF_ID);
      expect(transfer.organizationId).toBe(ORG_ID);
      expect(transfer.sourceWarehouseId).toBe(WH_SRC);
      expect(transfer.destinationWarehouseId).toBe(WH_DST);
      expect(transfer.status).toBe('DRAFT');
      expect(transfer.dispatchedAt).toBeNull();
      expect(transfer.receivedAt).toBeNull();
      expect(transfer.version).toBe(1);
      expect(transfer.expectedVersion).toBe(0);
      expect(transfer.hasPendingChanges).toBe(true);
    });

    it('given a new transfer when created then TransferCreated event emitted', () => {
      const transfer = StockTransfer.create(
        {
          id: TF_ID,
          organizationId: ORG_ID,
          sourceWarehouseId: WH_SRC,
          destinationWarehouseId: WH_DST,
        },
        { clock: CLOCK },
      );

      const events = transfer.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('TransferCreated');
      if (events[0].type === 'TransferCreated') {
        expect(events[0].sourceWarehouseId).toBe(WH_SRC);
        expect(events[0].destinationWarehouseId).toBe(WH_DST);
        expect(events[0].organizationId).toBe(ORG_ID);
        expect(events[0].aggregateId).toBe(TF_ID);
      }
    });

    it('given a transfer when source=destination then VALIDATION_FAILED error', () => {
      let error: unknown;
      try {
        StockTransfer.create({
          id: TF_ID,
          organizationId: ORG_ID,
          sourceWarehouseId: WH_SRC,
          destinationWarehouseId: WH_SRC,
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  // =========================================================================
  // Reconstitution
  // =========================================================================
  describe('reconstitute', () => {
    it('given persisted state when reconstituting then version matches and no events emitted', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'DISPATCHED',
        dispatchedAt: new Date('2025-06-10T08:00:00Z'),
        receivedAt: null,
        version: 2,
      });

      expect(transfer.status).toBe('DISPATCHED');
      expect(transfer.version).toBe(2);
      expect(transfer.expectedVersion).toBe(2);
      expect(transfer.hasPendingChanges).toBe(false);
      expect(transfer.pullDomainEvents()).toHaveLength(0);
    });
  });

  // =========================================================================
  // Dispatch
  // =========================================================================
  describe('dispatchTransfer', () => {
    it('given a DRAFT transfer when dispatched then status=DISPATCHED and dispatchedAt set', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'DRAFT',
        dispatchedAt: null,
        receivedAt: null,
        version: 1,
      });

      transfer.dispatchTransfer();

      expect(transfer.status).toBe('DISPATCHED');
      expect(transfer.dispatchedAt).toBeInstanceOf(Date);
      expect(transfer.version).toBe(2);
    });

    it('given a DRAFT transfer when dispatched then TransferDispatched event emitted', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'DRAFT',
        dispatchedAt: null,
        receivedAt: null,
        version: 1,
      });

      transfer.dispatchTransfer();

      const events = transfer.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('TransferDispatched');
    });
  });

  // =========================================================================
  // In transit
  // =========================================================================
  describe('markInTransit', () => {
    it('given a DISPATCHED transfer when marked in transit then status=IN_TRANSIT', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'DISPATCHED',
        dispatchedAt: new Date('2025-06-10T08:00:00Z'),
        receivedAt: null,
        version: 2,
      });

      transfer.markInTransit();

      expect(transfer.status).toBe('IN_TRANSIT');
      expect(transfer.version).toBe(3);
    });

    it('given a DRAFT transfer when trying to mark in transit then TRANSFER_INVALID_STATE error', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'DRAFT',
        dispatchedAt: null,
        receivedAt: null,
        version: 1,
      });

      let error: unknown;
      try {
        transfer.markInTransit();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.TRANSFER_INVALID_STATE);
    });
  });

  // =========================================================================
  // Receive
  // =========================================================================
  describe('receiveTransfer', () => {
    it('given an IN_TRANSIT transfer when received then status=RECEIVED and receivedAt set', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'IN_TRANSIT',
        dispatchedAt: new Date('2025-06-10T08:00:00Z'),
        receivedAt: null,
        version: 3,
      });

      transfer.receiveTransfer();

      expect(transfer.status).toBe('RECEIVED');
      expect(transfer.receivedAt).toBeInstanceOf(Date);
      expect(transfer.version).toBe(4);
    });

    it('given a received transfer when events emitted then correct events produced', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'IN_TRANSIT',
        dispatchedAt: new Date('2025-06-10T08:00:00Z'),
        receivedAt: null,
        version: 3,
      });

      transfer.receiveTransfer();

      const events = transfer.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('TransferReceived');
      if (events[0].type === 'TransferReceived') {
        expect(events[0].organizationId).toBe(ORG_ID);
        expect(events[0].aggregateId).toBe(TF_ID);
        expect(events[0].occurredAt).toBeInstanceOf(Date);
      }
    });

    it('given a DISPATCHED transfer when trying to receive directly then TRANSFER_INVALID_STATE error', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'DISPATCHED',
        dispatchedAt: new Date('2025-06-10T08:00:00Z'),
        receivedAt: null,
        version: 2,
      });

      let error: unknown;
      try {
        transfer.receiveTransfer();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.TRANSFER_INVALID_STATE);
    });
  });

  // =========================================================================
  // Cancel
  // =========================================================================
  describe('cancelTransfer', () => {
    it('given a DRAFT transfer when cancelled then status=CANCELLED', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'DRAFT',
        dispatchedAt: null,
        receivedAt: null,
        version: 1,
      });

      transfer.cancelTransfer();

      expect(transfer.status).toBe('CANCELLED');
      expect(transfer.version).toBe(2);
    });

    it('given a DRAFT transfer when cancelled then TransferCancelled event emitted', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'DRAFT',
        dispatchedAt: null,
        receivedAt: null,
        version: 1,
      });

      transfer.cancelTransfer();

      const events = transfer.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('TransferCancelled');
    });

    it('given a DISPATCHED transfer when cancelled then status=CANCELLED', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'DISPATCHED',
        dispatchedAt: new Date('2025-06-10T08:00:00Z'),
        receivedAt: null,
        version: 2,
      });

      transfer.cancelTransfer();

      expect(transfer.status).toBe('CANCELLED');
    });

    it('given an IN_TRANSIT transfer when trying to cancel then TRANSFER_INVALID_STATE error', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'IN_TRANSIT',
        dispatchedAt: new Date('2025-06-10T08:00:00Z'),
        receivedAt: null,
        version: 3,
      });

      let error: unknown;
      try {
        transfer.cancelTransfer();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.TRANSFER_INVALID_STATE);
      expect(transfer.status).toBe('IN_TRANSIT');
    });

    it('given a RECEIVED transfer when trying to cancel then TRANSFER_INVALID_STATE error', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'RECEIVED',
        dispatchedAt: new Date('2025-06-10T08:00:00Z'),
        receivedAt: new Date('2025-06-12T08:00:00Z'),
        version: 4,
      });

      let error: unknown;
      try {
        transfer.cancelTransfer();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.TRANSFER_INVALID_STATE);
    });

    it('given a CANCELLED transfer when trying to cancel again then TRANSFER_INVALID_STATE error', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'CANCELLED',
        dispatchedAt: null,
        receivedAt: null,
        version: 2,
      });

      let error: unknown;
      try {
        transfer.cancelTransfer();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.TRANSFER_INVALID_STATE);
    });
  });

  // =========================================================================
  // Full lifecycle
  // =========================================================================
  describe('full lifecycle', () => {
    it('given a DRAFT transfer when going through full lifecycle then all transitions succeed', () => {
      const transfer = StockTransfer.reconstitute({
        id: TF_ID,
        organizationId: ORG_ID,
        sourceWarehouseId: WH_SRC,
        destinationWarehouseId: WH_DST,
        status: 'DRAFT',
        dispatchedAt: null,
        receivedAt: null,
        version: 1,
      });

      transfer.dispatchTransfer();
      expect(transfer.status).toBe('DISPATCHED');

      transfer.markInTransit();
      expect(transfer.status).toBe('IN_TRANSIT');

      transfer.receiveTransfer();
      expect(transfer.status).toBe('RECEIVED');
      expect(transfer.receivedAt).toBeInstanceOf(Date);
      expect(transfer.version).toBe(4);
    });
  });
});
