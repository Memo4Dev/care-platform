import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type { SaleDomainEvent } from './events';

export type SaleStatus = 'PENDING_PAYMENT' | 'COMPLETED' | 'CANCELLED';

export interface SaleItemState {
  id: string;
  cartItemId: string | null;
  productId: string | null;
  variantId: string;
  productName: string | null;
  variantName: string | null;
  snapshotLabel: string;
  sku: string | null;
  barcode: string | null;
  unitId: string;
  baseUnitId: string | null;
  quantity: string;
  baseQuantity: string;
  unitPrice: string;
  lineSubtotal: string;
  discountTotal: string;
  taxTotal: string;
  lineTotal: string;
  currency: string;
  priceType: 'CASH' | 'WHOLESALE' | 'CREDIT' | 'ONLINE';
  pricingSource: 'BRANCH' | 'ORGANIZATIONAL';
  pricingReference: string | null;
}

export interface SaleState {
  id: string;
  organizationId: string;
  branchId: string;
  warehouseId: string | null;
  cartId: string;
  cartVersion: number;
  customerId: string | null;
  customerType: 'INDIVIDUAL' | 'BUSINESS' | null;
  customerDisplayName: string | null;
  customerCode: string | null;
  operatorId: string;
  deviceId: string | null;
  saleNumber: string;
  status: SaleStatus;
  priceType: 'CASH' | 'WHOLESALE' | 'CREDIT' | 'ONLINE';
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  inventoryReservationId: string;
  inventoryAllocationId: string | null;
  completionReferenceType: string | null;
  completionReferenceId: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  cancelledBy: string | null;
  correlationId: string;
  causationId: string;
  version: number;
  items: readonly SaleItemState[];
}

export class Sale {
  private readonly domainEvents: SaleDomainEvent[] = [];

  private constructor(
    private state: SaleState,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  static create(state: SaleState): Sale {
    if (state.status !== 'PENDING_PAYMENT') {
      throw PlatformError.of(
        ERROR_CODES.SALE_INVALID_STATE,
        'New Sale must start in PENDING_PAYMENT.',
      );
    }
    const sale = new Sale(state);
    sale.domainEvents.push({
      type: 'SaleCreated',
      occurredAt: sale.clock(),
      organizationId: state.organizationId,
      aggregateId: state.id,
      aggregateVersion: state.version,
      cartId: state.cartId,
      branchId: state.branchId,
      status: 'PENDING_PAYMENT',
      reservationId: state.inventoryReservationId,
    });
    return sale;
  }

  static reconstitute(state: SaleState): Sale {
    return new Sale(state);
  }

  get snapshot(): SaleState {
    return { ...this.state, items: this.state.items.map((item) => ({ ...item })) };
  }

  cancel(reason: string, actorId: string): void {
    if (this.state.status === 'CANCELLED') return;
    if (this.state.status === 'COMPLETED') {
      throw PlatformError.of(ERROR_CODES.SALE_INVALID_STATE, 'Completed Sale cannot be cancelled.');
    }
    this.state = {
      ...this.state,
      status: 'CANCELLED',
      cancelledAt: this.clock(),
      cancellationReason: reason,
      cancelledBy: actorId,
      version: this.state.version + 1,
    };
    this.domainEvents.push({
      type: 'SaleCancelled',
      occurredAt: this.state.cancelledAt ?? this.clock(),
      organizationId: this.state.organizationId,
      aggregateId: this.state.id,
      aggregateVersion: this.state.version,
      reason,
    });
  }

  complete(referenceType: string, referenceId: string): void {
    if (this.state.status === 'COMPLETED') return;
    if (this.state.status !== 'PENDING_PAYMENT') {
      throw PlatformError.of(
        ERROR_CODES.SALE_INVALID_STATE,
        'Only PENDING_PAYMENT Sale can complete.',
      );
    }
    this.state = {
      ...this.state,
      status: 'COMPLETED',
      completionReferenceType: referenceType,
      completionReferenceId: referenceId,
      completedAt: this.clock(),
      version: this.state.version + 1,
    };
    this.domainEvents.push({
      type: 'SaleCompleted',
      occurredAt: this.state.completedAt ?? this.clock(),
      organizationId: this.state.organizationId,
      aggregateId: this.state.id,
      aggregateVersion: this.state.version,
      completionReferenceType: referenceType,
      completionReferenceId: referenceId,
    });
  }

  pullDomainEvents(): SaleDomainEvent[] {
    return this.domainEvents.splice(0, this.domainEvents.length);
  }
}
