export const SALES_AGGREGATE_TYPE = 'Sale';

export interface SaleCreatedEvent {
  type: 'SaleCreated';
  occurredAt: Date;
  organizationId: string;
  aggregateId: string;
  aggregateVersion: number;
  cartId: string;
  branchId: string;
  status: 'PENDING_PAYMENT';
  reservationId: string;
}

export interface SaleCancelledEvent {
  type: 'SaleCancelled';
  occurredAt: Date;
  organizationId: string;
  aggregateId: string;
  aggregateVersion: number;
  reason: string;
}

export interface SaleCompletedEvent {
  type: 'SaleCompleted';
  occurredAt: Date;
  organizationId: string;
  aggregateId: string;
  aggregateVersion: number;
  completionReferenceType: string;
  completionReferenceId: string;
}

export type SaleDomainEvent = SaleCreatedEvent | SaleCancelledEvent | SaleCompletedEvent;
