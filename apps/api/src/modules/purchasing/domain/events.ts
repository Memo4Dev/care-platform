/**
 * Domain events of the Purchasing context.
 *
 * Events are plain data: they are collected inside aggregates and persisted to
 * the integration outbox by the repository within the same transaction as the
 * state change. Serialization is JSON; keep payloads free of functions,
 * class instances and sensitive data.
 *
 * Event type naming follows the `context.entity-action` convention documented
 * in docs/architecture/58-event-contracts.md for the integration topic, while
 * the internal `type` field uses the PascalCase literal established by the
 * Inventory module (e.g. `'GoodsReceiptConfirmed'`).
 *
 * This file imports only plain contracts: no NestJS, no Drizzle, no Inventory.
 */

// ---------------------------------------------------------------------------
// Supplier events
// ---------------------------------------------------------------------------

export interface SupplierCreatedEvent {
  readonly type: 'SupplierCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly name: string;
  readonly code: string;
}

export interface SupplierUpdatedEvent {
  readonly type: 'SupplierUpdated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly name: string;
}

export interface SupplierDeactivatedEvent {
  readonly type: 'SupplierDeactivated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
}

// ---------------------------------------------------------------------------
// Purchase Order events
// ---------------------------------------------------------------------------

/** Plain payload describing a purchase order line item inside an event. */
export interface PurchaseOrderItemEventData {
  readonly id: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly unitCost: number;
  readonly packagingUnit?: string | null;
  readonly packagingQuantity?: number | null;
  readonly packagingConversion?: number | null;
  readonly notes?: string | null;
}

export interface PurchaseOrderCreatedEvent {
  readonly type: 'PurchaseOrderCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly supplierId: string;
  readonly warehouseId: string;
  readonly orderDate: Date;
  readonly expectedDeliveryDate?: Date | null;
  readonly notes?: string | null;
  readonly items: readonly PurchaseOrderItemEventData[];
}

export interface PurchaseOrderSubmittedEvent {
  readonly type: 'PurchaseOrderSubmitted';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
}

export interface PurchaseOrderApprovedEvent {
  readonly type: 'PurchaseOrderApproved';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
}

export interface PurchaseOrderRejectedEvent {
  readonly type: 'PurchaseOrderRejected';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly reason?: string | null;
}

export interface PurchaseOrderSentEvent {
  readonly type: 'PurchaseOrderSent';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
}

export interface PurchaseOrderCancelledEvent {
  readonly type: 'PurchaseOrderCancelled';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly reason?: string | null;
}

export interface PurchaseOrderUpdatedEvent {
  readonly type: 'PurchaseOrderUpdated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
}

export interface PurchaseOrderItemAddedEvent {
  readonly type: 'PurchaseOrderItemAdded';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly item: PurchaseOrderItemEventData;
}

export interface PurchaseOrderItemUpdatedEvent {
  readonly type: 'PurchaseOrderItemUpdated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly itemId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly unitCost: number;
  readonly packagingUnit?: string | null;
  readonly packagingQuantity?: number | null;
  readonly packagingConversion?: number | null;
  readonly notes?: string | null;
}

export interface PurchaseOrderItemRemovedEvent {
  readonly type: 'PurchaseOrderItemRemoved';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly itemId: string;
}

// ---------------------------------------------------------------------------
// Goods Receipt events
// ---------------------------------------------------------------------------

/** Plain payload describing a goods receipt line item inside an event. */
export interface GoodsReceiptItemEventData {
  readonly id: string;
  readonly purchaseOrderItemId: string;
  readonly variantId: string;
  readonly quantityReceived: number;
  readonly quantityAccepted: number;
  readonly quantityRejected: number;
  readonly unitCost: number;
  readonly notes?: string | null;
}

/** Plain payload describing an additional purchase cost inside an event. */
export interface GoodsReceiptCostEventData {
  readonly id: string;
  readonly costType: string;
  readonly amount: number;
  readonly description?: string | null;
}

export interface GoodsReceiptCreatedEvent {
  readonly type: 'GoodsReceiptCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly purchaseOrderId: string;
  readonly warehouseId: string;
  readonly receivedDate: Date;
  readonly notes?: string | null;
  readonly items: readonly GoodsReceiptItemEventData[];
  readonly costs: readonly GoodsReceiptCostEventData[];
}

/**
 * Emitted when a Goods Receipt is confirmed.
 *
 * This is the CRITICAL integration event that drives Inventory receipt: only
 * the accepted quantities (per item) enter Inventory as FIFO layers, and the
 * additional costs feed the Actual Cost / landed-cost allocation. The payload
 * carries everything the Inventory consumer needs to create FIFO layers with
 * correct landed cost:
 *   - per-item variantId, quantityAccepted, unitCost
 *   - the additional costs (for landed-cost allocation)
 *   - pre-computed totals for convenience
 */
export interface GoodsReceiptConfirmedEvent {
  readonly type: 'GoodsReceiptConfirmed';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly purchaseOrderId: string;
  readonly warehouseId: string;
  readonly confirmedAt: Date;
  readonly confirmedBy: string;
  readonly items: readonly GoodsReceiptItemEventData[];
  readonly costs: readonly GoodsReceiptCostEventData[];
  readonly totalAcceptedQuantity: number;
  readonly totalAdditionalCosts: number;
}

export interface GoodsReceiptCancelledEvent {
  readonly type: 'GoodsReceiptCancelled';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly reason?: string | null;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type PurchasingDomainEvent =
  | SupplierCreatedEvent
  | SupplierUpdatedEvent
  | SupplierDeactivatedEvent
  | PurchaseOrderCreatedEvent
  | PurchaseOrderUpdatedEvent
  | PurchaseOrderSubmittedEvent
  | PurchaseOrderApprovedEvent
  | PurchaseOrderRejectedEvent
  | PurchaseOrderSentEvent
  | PurchaseOrderCancelledEvent
  | PurchaseOrderItemAddedEvent
  | PurchaseOrderItemUpdatedEvent
  | PurchaseOrderItemRemovedEvent
  | GoodsReceiptCreatedEvent
  | GoodsReceiptConfirmedEvent
  | GoodsReceiptCancelledEvent;

/** Stable aggregate family name used in the integration outbox rows. */
export const PURCHASING_AGGREGATE_TYPE = 'Purchasing' as const;
