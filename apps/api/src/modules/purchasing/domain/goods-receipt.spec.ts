import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { GoodsReceipt } from './goods-receipt';
import type { GoodsReceiptItem, GoodsReceiptCost } from './goods-receipt';

// ---------------------------------------------------------------------------
// Deterministic test data
// ---------------------------------------------------------------------------
const ORG_ID = '01980000-0000-7000-8000-000000000001';
const GR_ID = '01980000-0000-7000-8000-000000000070';
const PO_ID = '01980000-0000-7000-8000-000000000060';
const WH_ID = '01980000-0000-7000-8000-000000000010';
const VAR_ID_1 = '01980000-0000-7000-8000-000000000020';
const PO_ITEM_ID_1 = '01980000-0000-7000-8000-0000000000B1';
const GR_ITEM_ID_1 = '01980000-0000-7000-8000-0000000000C1';
const COST_ID_1 = '01980000-0000-7000-8000-0000000000D1';
const COST_ID_2 = '01980000-0000-7000-8000-0000000000D2';
const ACTOR_ID = '01980000-0000-7000-8000-0000000000E1';
const CLOCK = () => new Date('2025-06-15T10:00:00Z');

function createValidGR(overrides?: {
  items?: Array<{ id: string; purchaseOrderItemId: string; variantId: string; quantityReceived: number; quantityAccepted: number; unitCost: number }>;
  costs?: Array<{ id: string; costType: 'SHIPPING' | 'CUSTOMS' | 'HANDLING' | 'OTHER'; amount: number }>;
}): GoodsReceipt {
  return GoodsReceipt.create(
    {
      id: GR_ID,
      organizationId: ORG_ID,
      purchaseOrderId: PO_ID,
      warehouseId: WH_ID,
      items: overrides?.items ?? [
        { id: GR_ITEM_ID_1, purchaseOrderItemId: PO_ITEM_ID_1, variantId: VAR_ID_1, quantityReceived: 10, quantityAccepted: 10, unitCost: 5.0 },
      ],
      costs: overrides?.costs,
    },
    { clock: CLOCK },
  );
}

describe('GoodsReceipt', () => {
  // =========================================================================
  // Creation
  // =========================================================================
  describe('create', () => {
    it('given valid input when creating then status is PENDING', () => {
      const gr = createValidGR({
        costs: [{ id: COST_ID_1, costType: 'SHIPPING', amount: 50.0 }],
      });

      expect(gr.id).toBe(GR_ID);
      expect(gr.organizationId).toBe(ORG_ID);
      expect(gr.purchaseOrderId).toBe(PO_ID);
      expect(gr.warehouseId).toBe(WH_ID);
      expect(gr.status).toBe('PENDING');
      expect(gr.items).toHaveLength(1);
      expect(gr.items[0].quantityReceived).toBe(10);
      expect(gr.items[0].quantityAccepted).toBe(10);
      expect(gr.costs).toHaveLength(1);
      expect(gr.costs[0].amount).toBe(50.0);
      expect(gr.version).toBe(1);
      expect(gr.expectedVersion).toBe(0);
      expect(gr.hasPendingChanges).toBe(true);
      expect(gr.confirmedAt).toBeNull();
      expect(gr.confirmedBy).toBeNull();
    });

    it('given valid input when creating then GoodsReceiptCreated event emitted', () => {
      const gr = createValidGR();

      const events = gr.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('GoodsReceiptCreated');
      if (events[0].type === 'GoodsReceiptCreated') {
        expect(events[0].aggregateId).toBe(GR_ID);
        expect(events[0].purchaseOrderId).toBe(PO_ID);
        expect(events[0].warehouseId).toBe(WH_ID);
        expect(events[0].items).toHaveLength(1);
      }
    });

    it('given mismatched quantities when creating then throws VALIDATION_FAILED', () => {
      let error: unknown;
      try {
        GoodsReceipt.create({
          id: GR_ID,
          organizationId: ORG_ID,
          purchaseOrderId: PO_ID,
          warehouseId: WH_ID,
          items: [
            { id: GR_ITEM_ID_1, purchaseOrderItemId: PO_ITEM_ID_1, variantId: VAR_ID_1, quantityReceived: 10, quantityAccepted: 8, quantityRejected: 0, unitCost: 5.0 },
          ],
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given zero received quantity when creating then throws VALIDATION_FAILED', () => {
      let error: unknown;
      try {
        GoodsReceipt.create({
          id: GR_ID,
          organizationId: ORG_ID,
          purchaseOrderId: PO_ID,
          warehouseId: WH_ID,
          items: [
            { id: GR_ITEM_ID_1, purchaseOrderItemId: PO_ITEM_ID_1, variantId: VAR_ID_1, quantityReceived: 0, quantityAccepted: 0, unitCost: 5.0 },
          ],
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  // =========================================================================
  // confirm
  // =========================================================================
  describe('confirm', () => {
    it('given PENDING GR when confirming with accepted qty then status is CONFIRMED', () => {
      const gr = createValidGR();
      gr.pullDomainEvents();

      gr.confirm(ACTOR_ID);

      expect(gr.status).toBe('CONFIRMED');
      expect(gr.confirmedBy).toBe(ACTOR_ID);
      expect(gr.confirmedAt).toBeInstanceOf(Date);
      expect(gr.version).toBe(2);

      const events = gr.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('GoodsReceiptConfirmed');
      if (events[0].type === 'GoodsReceiptConfirmed') {
        expect(events[0].confirmedBy).toBe(ACTOR_ID);
        expect(events[0].totalAcceptedQuantity).toBe(10);
      }
    });

    it('given PENDING GR when confirming with zero accepted then throws', () => {
      // Reconstitute with zero accepted qty (bypasses create-time validation
      // to simulate a persisted state where accepted was recorded as 0).
      const gr = GoodsReceipt.reconstitute({
        id: GR_ID,
        organizationId: ORG_ID,
        purchaseOrderId: PO_ID,
        warehouseId: WH_ID,
        status: 'PENDING',
        receivedDate: new Date('2025-06-15T10:00:00Z'),
        items: [
          { id: GR_ITEM_ID_1, purchaseOrderItemId: PO_ITEM_ID_1, variantId: VAR_ID_1, quantityReceived: 10, quantityAccepted: 0, quantityRejected: 10, unitCost: 5.0, notes: null },
        ],
        costs: [],
        version: 1,
      });

      let error: unknown;
      try {
        gr.confirm(ACTOR_ID);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given CONFIRMED GR when confirming then throws OPERATION_NOT_ALLOWED', () => {
      const gr = createValidGR();
      gr.pullDomainEvents();
      gr.confirm(ACTOR_ID);
      gr.pullDomainEvents();

      let error: unknown;
      try {
        gr.confirm(ACTOR_ID);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });
  });

  // =========================================================================
  // cancel
  // =========================================================================
  describe('cancel', () => {
    it('given PENDING GR when cancelling then status is CANCELLED', () => {
      const gr = createValidGR();
      gr.pullDomainEvents();

      gr.cancel('No longer needed');

      expect(gr.status).toBe('CANCELLED');
      const events = gr.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('GoodsReceiptCancelled');
      if (events[0].type === 'GoodsReceiptCancelled') {
        expect(events[0].reason).toBe('No longer needed');
      }
    });

    it('given CONFIRMED GR when cancelling then throws OPERATION_NOT_ALLOWED', () => {
      const gr = createValidGR();
      gr.pullDomainEvents();
      gr.confirm(ACTOR_ID);
      gr.pullDomainEvents();

      let error: unknown;
      try {
        gr.cancel();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });
  });

  // =========================================================================
  // Queries
  // =========================================================================
  describe('queries', () => {
    it('given GR with additional costs when querying totalAdditionalCosts then correct sum', () => {
      const gr = createValidGR({
        costs: [
          { id: COST_ID_1, costType: 'SHIPPING', amount: 100.0 },
          { id: COST_ID_2, costType: 'CUSTOMS', amount: 50.5 },
        ],
      });

      expect(gr.totalAdditionalCosts).toBe(150.5);
    });

    it('given GR without costs when querying totalAdditionalCosts then zero', () => {
      const gr = createValidGR();

      expect(gr.totalAdditionalCosts).toBe(0);
    });

    it('given GR when querying totalAcceptedQuantity then correct sum', () => {
      const gr = GoodsReceipt.create(
        {
          id: GR_ID + '-2',
          organizationId: ORG_ID,
          purchaseOrderId: PO_ID,
          warehouseId: WH_ID,
          items: [
            { id: GR_ITEM_ID_1, purchaseOrderItemId: PO_ITEM_ID_1, variantId: VAR_ID_1, quantityReceived: 10, quantityAccepted: 8, quantityRejected: 2, unitCost: 5.0 },
          ],
        },
        { clock: CLOCK },
      );

      expect(gr.totalAcceptedQuantity).toBe(8);
    });
  });

  // =========================================================================
  // Reconstitution
  // =========================================================================
  describe('reconstitute', () => {
    it('given reconstituted GR when querying then state matches', () => {
      const items: GoodsReceiptItem[] = [
        { id: GR_ITEM_ID_1, purchaseOrderItemId: PO_ITEM_ID_1, variantId: VAR_ID_1, quantityReceived: 10, quantityAccepted: 8, quantityRejected: 2, unitCost: 5.0, notes: null },
      ];
      const costs: GoodsReceiptCost[] = [
        { id: COST_ID_1, costType: 'SHIPPING', amount: 100.0, description: null },
      ];

      const gr = GoodsReceipt.reconstitute({
        id: GR_ID,
        organizationId: ORG_ID,
        purchaseOrderId: PO_ID,
        warehouseId: WH_ID,
        status: 'CONFIRMED',
        receivedDate: new Date('2025-06-15T10:00:00Z'),
        confirmedAt: new Date('2025-06-15T11:00:00Z'),
        confirmedBy: ACTOR_ID,
        items,
        costs,
        version: 2,
      });

      expect(gr.id).toBe(GR_ID);
      expect(gr.status).toBe('CONFIRMED');
      expect(gr.purchaseOrderId).toBe(PO_ID);
      expect(gr.warehouseId).toBe(WH_ID);
      expect(gr.confirmedBy).toBe(ACTOR_ID);
      expect(gr.confirmedAt).toEqual(new Date('2025-06-15T11:00:00Z'));
      expect(gr.items).toHaveLength(1);
      expect(gr.items[0].quantityAccepted).toBe(8);
      expect(gr.costs).toHaveLength(1);
      expect(gr.totalAdditionalCosts).toBe(100.0);
      expect(gr.version).toBe(2);
      expect(gr.expectedVersion).toBe(2);
      expect(gr.hasPendingChanges).toBe(false);
      expect(gr.pullDomainEvents()).toHaveLength(0);
    });
  });
});
