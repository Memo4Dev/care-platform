import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { describe, expect, it } from 'vitest';

import { PurchaseOrder } from './purchase-order';
import type { PurchaseOrderItem } from './purchase-order';

// ---------------------------------------------------------------------------
// Deterministic test data
// ---------------------------------------------------------------------------
const ORG_ID = '01980000-0000-7000-8000-000000000001';
const PO_ID = '01980000-0000-7000-8000-000000000060';
const SUPPLIER_ID = '01980000-0000-7000-8000-000000000050';
const WH_ID = '01980000-0000-7000-8000-000000000010';
const VAR_ID_1 = '01980000-0000-7000-8000-000000000020';
const VAR_ID_2 = '01980000-0000-7000-8000-000000000021';
const ITEM_ID_1 = '01980000-0000-7000-8000-0000000000A1';
const ITEM_ID_2 = '01980000-0000-7000-8000-0000000000A2';
const CLOCK = () => new Date('2025-06-15T10:00:00Z');

function createValidPO(overrides?: {
  items?: Array<{ id: string; variantId: string; quantity: number; unitCost: number }>;
}): PurchaseOrder {
  return PurchaseOrder.create(
    {
      id: PO_ID,
      organizationId: ORG_ID,
      supplierId: SUPPLIER_ID,
      warehouseId: WH_ID,
      items: overrides?.items ?? [
        { id: ITEM_ID_1, variantId: VAR_ID_1, quantity: 10, unitCost: 5.0 },
      ],
    },
    { clock: CLOCK },
  );
}

function createSubmittedPO(): PurchaseOrder {
  const po = createValidPO({
    items: [
      { id: ITEM_ID_1, variantId: VAR_ID_1, quantity: 10, unitCost: 5.0 },
      { id: ITEM_ID_2, variantId: VAR_ID_2, quantity: 5, unitCost: 12.0 },
    ],
  });
  po.submit();
  po.pullDomainEvents(); // drain
  return po;
}

function createApprovedPO(): PurchaseOrder {
  const po = createSubmittedPO();
  po.approve();
  po.pullDomainEvents();
  return po;
}

describe('PurchaseOrder', () => {
  // =========================================================================
  // Creation
  // =========================================================================
  describe('create', () => {
    it('given valid input when creating then status is DRAFT with items', () => {
      const po = createValidPO({
        items: [
          { id: ITEM_ID_1, variantId: VAR_ID_1, quantity: 10, unitCost: 5.0 },
          { id: ITEM_ID_2, variantId: VAR_ID_2, quantity: 5, unitCost: 12.0 },
        ],
      });

      expect(po.id).toBe(PO_ID);
      expect(po.organizationId).toBe(ORG_ID);
      expect(po.supplierId).toBe(SUPPLIER_ID);
      expect(po.warehouseId).toBe(WH_ID);
      expect(po.status).toBe('DRAFT');
      expect(po.items).toHaveLength(2);
      expect(po.items[0].variantId).toBe(VAR_ID_1);
      expect(po.items[0].quantity).toBe(10);
      expect(po.items[0].unitCost).toBe(5.0);
      expect(po.version).toBe(1);
      expect(po.expectedVersion).toBe(0);
      expect(po.hasPendingChanges).toBe(true);
    });

    it('given valid input when creating then PurchaseOrderCreated event emitted', () => {
      const po = createValidPO();

      const events = po.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('PurchaseOrderCreated');
      if (events[0].type === 'PurchaseOrderCreated') {
        expect(events[0].aggregateId).toBe(PO_ID);
        expect(events[0].supplierId).toBe(SUPPLIER_ID);
        expect(events[0].warehouseId).toBe(WH_ID);
        expect(events[0].items).toHaveLength(1);
      }
    });

    it('given empty items when creating then throws VALIDATION_FAILED', () => {
      let error: unknown;
      try {
        PurchaseOrder.create({
          id: PO_ID,
          organizationId: ORG_ID,
          supplierId: SUPPLIER_ID,
          warehouseId: WH_ID,
          items: [],
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given zero quantity item when creating then throws VALIDATION_FAILED', () => {
      let error: unknown;
      try {
        PurchaseOrder.create({
          id: PO_ID,
          organizationId: ORG_ID,
          supplierId: SUPPLIER_ID,
          warehouseId: WH_ID,
          items: [{ id: ITEM_ID_1, variantId: VAR_ID_1, quantity: 0, unitCost: 5.0 }],
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given zero cost item when creating then throws VALIDATION_FAILED', () => {
      let error: unknown;
      try {
        PurchaseOrder.create({
          id: PO_ID,
          organizationId: ORG_ID,
          supplierId: SUPPLIER_ID,
          warehouseId: WH_ID,
          items: [{ id: ITEM_ID_1, variantId: VAR_ID_1, quantity: 10, unitCost: 0 }],
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });
  });

  // =========================================================================
  // Lifecycle transitions
  // =========================================================================
  describe('lifecycle', () => {
    it('given DRAFT PO when submitting then status is SUBMITTED', () => {
      const po = createValidPO();
      po.pullDomainEvents();

      po.submit();

      expect(po.status).toBe('SUBMITTED');
      expect(po.version).toBe(2);

      const events = po.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('PurchaseOrderSubmitted');
    });

    it('given SUBMITTED PO when approving then status is APPROVED', () => {
      const po = createSubmittedPO();

      po.approve();

      expect(po.status).toBe('APPROVED');
      const events = po.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('PurchaseOrderApproved');
    });

    it('given SUBMITTED PO when rejecting then status is REJECTED', () => {
      const po = createSubmittedPO();

      po.reject('Too expensive');

      expect(po.status).toBe('REJECTED');
      const events = po.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('PurchaseOrderRejected');
      if (events[0].type === 'PurchaseOrderRejected') {
        expect(events[0].reason).toBe('Too expensive');
      }
    });

    it('given APPROVED PO when sending then status is SENT', () => {
      const po = createApprovedPO();

      po.send();

      expect(po.status).toBe('SENT');
      const events = po.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('PurchaseOrderSent');
    });

    it('given DRAFT PO when cancelling then status is CANCELLED', () => {
      const po = createValidPO();
      po.pullDomainEvents();

      po.cancel('Changed mind');

      expect(po.status).toBe('CANCELLED');
      const events = po.pullDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('PurchaseOrderCancelled');
      if (events[0].type === 'PurchaseOrderCancelled') {
        expect(events[0].reason).toBe('Changed mind');
      }
    });

    it('given SENT PO when cancelling then status is CANCELLED', () => {
      const sentPO = createApprovedPO();
      sentPO.send();
      sentPO.pullDomainEvents();

      sentPO.cancel('Supplier delayed');

      expect(sentPO.status).toBe('CANCELLED');
    });

    it('given RECEIVED PO when cancelling then throws OPERATION_NOT_ALLOWED', () => {
      // Build a RECEIVED PO via the valid path: SENT → RECEIVED
      const po = createApprovedPO();
      po.send();
      po.pullDomainEvents();
      // Simulate receipt-driven transition at the domain level
      (po as { _status: string })._status = 'RECEIVED';
      po.pullDomainEvents();

      let error: unknown;
      try {
        po.cancel();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given SUBMITTED PO when submitting then throws OPERATION_NOT_ALLOWED', () => {
      const po = createSubmittedPO();

      let error: unknown;
      try {
        po.submit();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given SENT PO when submitting then throws OPERATION_NOT_ALLOWED', () => {
      const sentPO = createApprovedPO();
      sentPO.send();
      sentPO.pullDomainEvents();

      let error: unknown;
      try {
        sentPO.submit();
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });
  });

  // =========================================================================
  // Line item mutations (DRAFT only)
  // =========================================================================
  describe('line items', () => {
    it('given DRAFT PO when adding item then item added', () => {
      const po = createValidPO();
      po.pullDomainEvents();

      po.addItem({
        id: ITEM_ID_2,
        variantId: VAR_ID_2,
        quantity: 20,
        unitCost: 3.5,
      });

      expect(po.items).toHaveLength(2);
      expect(po.items[1].id).toBe(ITEM_ID_2);
      expect(po.items[1].variantId).toBe(VAR_ID_2);
      expect(po.items[1].quantity).toBe(20);
      expect(po.items[1].unitCost).toBe(3.5);

      const events = po.pullDomainEvents();
      const addedEvents = events.filter((e) => e.type === 'PurchaseOrderItemAdded');
      expect(addedEvents).toHaveLength(1);
    });

    it('given SUBMITTED PO when adding item then throws OPERATION_NOT_ALLOWED', () => {
      const po = createSubmittedPO();

      let error: unknown;
      try {
        po.addItem({
          id: ITEM_ID_2,
          variantId: VAR_ID_2,
          quantity: 20,
          unitCost: 3.5,
        });
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.OPERATION_NOT_ALLOWED);
    });

    it('given DRAFT PO with 1 item when removing then throws VALIDATION_FAILED', () => {
      const po = createValidPO();

      let error: unknown;
      try {
        po.removeItem(ITEM_ID_1);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('given DRAFT PO with 2 items when removing one then item removed', () => {
      const po = createValidPO({
        items: [
          { id: ITEM_ID_1, variantId: VAR_ID_1, quantity: 10, unitCost: 5.0 },
          { id: ITEM_ID_2, variantId: VAR_ID_2, quantity: 5, unitCost: 12.0 },
        ],
      });
      po.pullDomainEvents();

      po.removeItem(ITEM_ID_2);

      expect(po.items).toHaveLength(1);
      expect(po.items[0].id).toBe(ITEM_ID_1);

      const events = po.pullDomainEvents();
      const removedEvents = events.filter((e) => e.type === 'PurchaseOrderItemRemoved');
      expect(removedEvents).toHaveLength(1);
    });

    it('given DRAFT PO when updating item then item updated', () => {
      const po = createValidPO();
      po.pullDomainEvents();

      po.updateItem(ITEM_ID_1, { quantity: 25, unitCost: 8.0 });

      expect(po.items[0].quantity).toBe(25);
      expect(po.items[0].unitCost).toBe(8.0);

      const events = po.pullDomainEvents();
      const updatedEvents = events.filter((e) => e.type === 'PurchaseOrderItemUpdated');
      expect(updatedEvents).toHaveLength(1);
    });
  });

  // =========================================================================
  // Reconstitution
  // =========================================================================
  describe('reconstitute', () => {
    it('given reconstituted PO when querying status then matches', () => {
      const items: PurchaseOrderItem[] = [
        {
          id: ITEM_ID_1,
          variantId: VAR_ID_1,
          quantity: 10,
          unitCost: 5.0,
          packagingUnit: null,
          packagingQuantity: null,
          packagingConversion: null,
          notes: null,
        },
      ];

      const po = PurchaseOrder.reconstitute({
        id: PO_ID,
        organizationId: ORG_ID,
        supplierId: SUPPLIER_ID,
        status: 'SUBMITTED',
        warehouseId: WH_ID,
        orderDate: new Date('2025-06-15T10:00:00Z'),
        items,
        version: 3,
      });

      expect(po.id).toBe(PO_ID);
      expect(po.status).toBe('SUBMITTED');
      expect(po.supplierId).toBe(SUPPLIER_ID);
      expect(po.warehouseId).toBe(WH_ID);
      expect(po.items).toHaveLength(1);
      expect(po.version).toBe(3);
      expect(po.expectedVersion).toBe(3);
      expect(po.hasPendingChanges).toBe(false);
      expect(po.pullDomainEvents()).toHaveLength(0);
    });
  });
});
