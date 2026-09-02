import { describe, expect, it } from 'vitest';

import { PlatformError } from '@commerce-platform/contracts';

import { Sale } from './sale';

const ids = {
  sale: '01900000-0000-7000-8000-000000000101',
  org: '01900000-0000-7000-8000-000000000102',
  branch: '01900000-0000-7000-8000-000000000103',
  warehouse: '01900000-0000-7000-8000-000000000104',
  cart: '01900000-0000-7000-8000-000000000105',
  customer: '01900000-0000-7000-8000-000000000106',
  operator: '01900000-0000-7000-8000-000000000107',
  reservation: '01900000-0000-7000-8000-000000000108',
  item: '01900000-0000-7000-8000-000000000109',
  product: '01900000-0000-7000-8000-000000000110',
  variant: '01900000-0000-7000-8000-000000000111',
  unit: '01900000-0000-7000-8000-000000000112',
};

function pendingSale() {
  return Sale.create({
    id: ids.sale,
    organizationId: ids.org,
    branchId: ids.branch,
    warehouseId: ids.warehouse,
    cartId: ids.cart,
    cartVersion: 3,
    customerId: ids.customer,
    customerType: 'BUSINESS',
    customerDisplayName: 'Acme',
    customerCode: 'C-1',
    operatorId: ids.operator,
    deviceId: null,
    saleNumber: 'SALE-000001',
    status: 'PENDING_PAYMENT',
    priceType: 'CASH',
    currency: 'EGP',
    subtotal: '10.00000000',
    discountTotal: '0.00000000',
    taxTotal: '0.00000000',
    total: '10.00000000',
    inventoryReservationId: ids.reservation,
    inventoryAllocationId: null,
    completionReferenceType: null,
    completionReferenceId: null,
    completedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    cancelledBy: null,
    correlationId: 'corr-1',
    causationId: 'cause-1',
    version: 1,
    items: [
      {
        id: ids.item,
        cartItemId: null,
        productId: ids.product,
        variantId: ids.variant,
        productName: 'Painkiller',
        variantName: 'Box',
        snapshotLabel: 'Painkiller / Box',
        sku: 'SKU-1',
        barcode: 'BC-1',
        unitId: ids.unit,
        baseUnitId: ids.unit,
        quantity: '1.00000000',
        baseQuantity: '1.00000000',
        unitPrice: '10.00000000',
        lineSubtotal: '10.00000000',
        discountTotal: '0.00000000',
        taxTotal: '0.00000000',
        lineTotal: '10.00000000',
        currency: 'EGP',
        priceType: 'CASH',
        pricingSource: 'BRANCH',
        pricingReference: 'ref-1',
      },
    ],
  });
}

describe('Sale aggregate', () => {
  it('creates a new sale only in PENDING_PAYMENT and emits SaleCreated', () => {
    const sale = pendingSale();

    expect(sale.snapshot.status).toBe('PENDING_PAYMENT');
    expect(sale.snapshot.inventoryReservationId).toBe(ids.reservation);
    expect(sale.pullDomainEvents()).toMatchObject([
      { type: 'SaleCreated', aggregateId: ids.sale, status: 'PENDING_PAYMENT' },
    ]);
  });

  it('cancels a pending sale and preserves idempotent repeat cancel', () => {
    const sale = pendingSale();
    sale.pullDomainEvents();

    sale.cancel('customer left', ids.operator);
    const first = sale.snapshot;
    sale.cancel('customer left', ids.operator);

    expect(first.status).toBe('CANCELLED');
    expect(first.cancellationReason).toBe('customer left');
    expect(sale.snapshot.version).toBe(2);
    expect(sale.pullDomainEvents()).toMatchObject([
      { type: 'SaleCancelled', reason: 'customer left' },
    ]);
  });

  it('completes a pending sale and rejects cancellation after completion', () => {
    const sale = pendingSale();
    sale.pullDomainEvents();

    sale.complete('PAYMENT', 'payment-1');

    expect(sale.snapshot.status).toBe('COMPLETED');
    expect(sale.snapshot.completionReferenceId).toBe('payment-1');
    expect(() => sale.cancel('too late', ids.operator)).toThrow(PlatformError);
  });
});
