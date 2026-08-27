import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { FIFOLayer } from './fifo-layer';

// ---------------------------------------------------------------------------
// Deterministic test data
// ---------------------------------------------------------------------------
const SP_ID = '01980000-0000-7000-8000-000000000030';
const EARLIER = new Date('2025-06-01T08:00:00Z');

describe('FIFOLayer', () => {
  // =========================================================================
  // Creation
  // =========================================================================
  describe('create', () => {
    it('given a FIFO layer when created then remaining equals quantity', () => {
      const layer = FIFOLayer.create({
        id: 'layer-1',
        stockPositionId: SP_ID,
        receivedAt: EARLIER,
        quantity: 50,
        unitCost: 2.5,
      });

      expect(layer.id).toBe('layer-1');
      expect(layer.stockPositionId).toBe(SP_ID);
      expect(layer.quantity).toBe(50);
      expect(layer.remainingQuantity).toBe(50);
      expect(layer.unitCost).toBe(2.5);
      expect(layer.receivedAt).toBe(EARLIER);
      expect(layer.isFullyConsumed).toBe(false);
      expect(layer.version).toBe(1);
      expect(layer.expectedVersion).toBe(0);
    });

    it('given a FIFO layer with zero quantity when creating then VALIDATION_FAILED error', () => {
      let error: unknown;
      try {
        FIFOLayer.create({
          id: 'layer-1',
          stockPositionId: SP_ID,
          quantity: 0,
          unitCost: 1.0,
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given a FIFO layer with negative quantity when creating then VALIDATION_FAILED error', () => {
      let error: unknown;
      try {
        FIFOLayer.create({
          id: 'layer-1',
          stockPositionId: SP_ID,
          quantity: -5,
          unitCost: 1.0,
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
    it('given persisted state when reconstituting then version and remaining match', () => {
      const layer = FIFOLayer.reconstitute({
        id: 'layer-1',
        stockPositionId: SP_ID,
        receivedAt: EARLIER,
        quantity: 100,
        remainingQuantity: 60,
        unitCost: 3.0,
        version: 4,
      });

      expect(layer.quantity).toBe(100);
      expect(layer.remainingQuantity).toBe(60);
      expect(layer.version).toBe(4);
      expect(layer.expectedVersion).toBe(4);
      expect(layer.hasPendingChanges).toBe(false);
    });
  });

  // =========================================================================
  // Consumption
  // =========================================================================
  describe('consume', () => {
    it('given a FIFO layer when consuming partially then remaining tracks correctly', () => {
      const layer = FIFOLayer.create({
        id: 'layer-1',
        stockPositionId: SP_ID,
        receivedAt: EARLIER,
        quantity: 100,
        unitCost: 2.0,
      });

      layer.consume(30);

      expect(layer.remainingQuantity).toBe(70);
      expect(layer.quantity).toBe(100);
      expect(layer.isFullyConsumed).toBe(false);
      expect(layer.hasPendingChanges).toBe(true);
    });

    it('given a FIFO layer when consuming exact quantity then layer marked as 0 remaining', () => {
      const layer = FIFOLayer.create({
        id: 'layer-1',
        stockPositionId: SP_ID,
        receivedAt: EARLIER,
        quantity: 50,
        unitCost: 2.0,
      });

      layer.consume(50);

      expect(layer.remainingQuantity).toBe(0);
      expect(layer.isFullyConsumed).toBe(true);
    });

    it('given a FIFO layer when remaining=0 then cannot consume more', () => {
      const layer = FIFOLayer.create({
        id: 'layer-1',
        stockPositionId: SP_ID,
        receivedAt: EARLIER,
        quantity: 10,
        unitCost: 1.0,
      });

      layer.consume(10);

      let error: unknown;
      try {
        layer.consume(1);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.INVENTORY_INSUFFICIENT);
    });

    it('given a FIFO layer when consuming more than remaining then INVENTORY_INSUFFICIENT error', () => {
      const layer = FIFOLayer.create({
        id: 'layer-1',
        stockPositionId: SP_ID,
        receivedAt: EARLIER,
        quantity: 20,
        unitCost: 1.0,
      });

      let error: unknown;
      try {
        layer.consume(25);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.INVENTORY_INSUFFICIENT);
      expect(layer.remainingQuantity).toBe(20);
    });

    it('given a FIFO layer when consuming zero then no change', () => {
      const layer = FIFOLayer.create({
        id: 'layer-1',
        stockPositionId: SP_ID,
        receivedAt: EARLIER,
        quantity: 50,
        unitCost: 1.0,
      });

      layer.consume(0);

      expect(layer.remainingQuantity).toBe(50);
    });

    it('given a FIFO layer when consuming negative then VALIDATION_FAILED error', () => {
      const layer = FIFOLayer.create({
        id: 'layer-1',
        stockPositionId: SP_ID,
        receivedAt: EARLIER,
        quantity: 50,
        unitCost: 1.0,
      });

      let error: unknown;
      try {
        layer.consume(-5);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  // =========================================================================
  // canConsume
  // =========================================================================
  describe('canConsume', () => {
    it('given a FIFO layer when canConsume with sufficient remaining then true', () => {
      const layer = FIFOLayer.create({
        id: 'layer-1',
        stockPositionId: SP_ID,
        receivedAt: EARLIER,
        quantity: 50,
        unitCost: 1.0,
      });

      expect(layer.canConsume(50)).toBe(true);
      expect(layer.canConsume(51)).toBe(false);
    });
  });

  // =========================================================================
  // markPersisted
  // =========================================================================
  describe('markPersisted', () => {
    it('given a FIFO layer with pending changes when markPersisted then no pending changes', () => {
      const layer = FIFOLayer.create({
        id: 'layer-1',
        stockPositionId: SP_ID,
        receivedAt: EARLIER,
        quantity: 50,
        unitCost: 1.0,
      });

      layer.consume(10);
      expect(layer.hasPendingChanges).toBe(true);

      layer.markPersisted();
      expect(layer.hasPendingChanges).toBe(false);
      expect(layer.version).toBe(layer.expectedVersion);
    });
  });
});
