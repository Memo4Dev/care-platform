import type { CursorPage } from '@commerce-platform/contracts';

export const SALES_CONTRACTS = Symbol('SALES_CONTRACTS');

export interface SaleItemView {
  readonly id: string;
  readonly variantId: string;
  readonly productId: string | null;
  readonly snapshotLabel: string;
  readonly sku: string | null;
  readonly barcode: string | null;
  readonly unitId: string;
  readonly baseUnitId: string | null;
  readonly quantity: string;
  readonly baseQuantity: string;
  readonly unitPrice: string;
  readonly lineSubtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly lineTotal: string;
  readonly currency: string;
  readonly priceType: 'CASH' | 'WHOLESALE' | 'CREDIT' | 'ONLINE';
  readonly pricingSource: 'BRANCH' | 'ORGANIZATIONAL';
}

export interface SaleView {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly warehouseId: string | null;
  readonly cartId: string;
  readonly cartVersion: number;
  readonly saleNumber: string;
  readonly status: 'PENDING_PAYMENT' | 'COMPLETED' | 'CANCELLED';
  readonly customerId: string | null;
  readonly operatorId: string;
  readonly deviceId: string | null;
  readonly priceType: 'CASH' | 'WHOLESALE' | 'CREDIT' | 'ONLINE';
  readonly currency: string;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly total: string;
  readonly inventoryReservationId: string;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly items: readonly SaleItemView[];
}

export interface SalesContracts {
  createSale(input: {
    organizationId: string;
    cartId: string;
    cartVersion: number;
    warehouseId?: string;
    priceType?: 'CASH' | 'WHOLESALE' | 'CREDIT' | 'ONLINE';
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
    causationId: string;
  }): Promise<SaleView>;
  getSale(organizationId: string, saleId: string): Promise<SaleView | null>;
  cancelSale(input: {
    organizationId: string;
    saleId: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
    causationId: string;
    reason: string;
  }): Promise<SaleView>;
  completeSaleAfterPayment(input: {
    organizationId: string;
    saleId: string;
    completionReferenceType: string;
    completionReferenceId: string;
    idempotencyKey: string;
    actorId: string;
    correlationId: string;
    causationId: string;
  }): Promise<SaleView>;
}

export type SalePage = CursorPage<SaleView>;
