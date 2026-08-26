/**
 * Domain events of the Inventory context.
 *
 * Events are plain data: they are collected inside aggregates and persisted to
 * the integration outbox by the repository within the same transaction as the
 * state change. Serialization is JSON; keep payloads free of functions,
 * class instances and sensitive data.
 *
 * Event type naming follows the `context.entity-action` convention defined in
 * docs/architecture/58-event-contracts.md.
 */

// ---------------------------------------------------------------------------
// Stock Position events
// ---------------------------------------------------------------------------

export interface StockPositionCreatedEvent {
  readonly type: 'StockPositionCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly warehouseId: string;
  readonly variantId: string;
}

export interface StockReceivedEvent {
  readonly type: 'StockReceived';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly warehouseId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly unitCost: number;
}

export interface StockConsumedEvent {
  readonly type: 'StockConsumed';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly warehouseId: string;
  readonly variantId: string;
  readonly quantity: number;
}

export interface StockReservedEvent {
  readonly type: 'StockReserved';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly warehouseId: string;
  readonly variantId: string;
  readonly quantity: number;
}

// ---------------------------------------------------------------------------
// Reservation events
// ---------------------------------------------------------------------------

export interface ReservationReleasedEvent {
  readonly type: 'ReservationReleased';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly stockPositionId: string;
}

export interface ReservationExpiredEvent {
  readonly type: 'ReservationExpired';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly stockPositionId: string;
}

export interface ReservationConsumedEvent {
  readonly type: 'ReservationConsumed';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly stockPositionId: string;
}

// ---------------------------------------------------------------------------
// Allocation events
// ---------------------------------------------------------------------------

export interface AllocationCreatedEvent {
  readonly type: 'AllocationCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly stockPositionId: string;
  readonly quantity: number;
}

export interface AllocationReleasedEvent {
  readonly type: 'AllocationReleased';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly stockPositionId: string;
}

export interface AllocationExpiredEvent {
  readonly type: 'AllocationExpired';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly stockPositionId: string;
}

export interface AllocationConsumedEvent {
  readonly type: 'AllocationConsumed';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly stockPositionId: string;
}

// ---------------------------------------------------------------------------
// Transfer events
// ---------------------------------------------------------------------------

export interface TransferCreatedEvent {
  readonly type: 'TransferCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly sourceWarehouseId: string;
  readonly destinationWarehouseId: string;
}

export interface TransferDispatchedEvent {
  readonly type: 'TransferDispatched';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
}

export interface TransferReceivedEvent {
  readonly type: 'TransferReceived';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
}

export interface TransferCancelledEvent {
  readonly type: 'TransferCancelled';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
}

// ---------------------------------------------------------------------------
// Adjustment events
// ---------------------------------------------------------------------------

export interface AdjustmentAppliedEvent {
  readonly type: 'AdjustmentApplied';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly aggregateId: string;
  readonly stockPositionId: string;
  readonly adjustmentType: string;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type InventoryDomainEvent =
  | StockPositionCreatedEvent
  | StockReceivedEvent
  | StockConsumedEvent
  | StockReservedEvent
  | ReservationReleasedEvent
  | ReservationExpiredEvent
  | ReservationConsumedEvent
  | AllocationCreatedEvent
  | AllocationReleasedEvent
  | AllocationExpiredEvent
  | AllocationConsumedEvent
  | TransferCreatedEvent
  | TransferDispatchedEvent
  | TransferReceivedEvent
  | TransferCancelledEvent
  | AdjustmentAppliedEvent;

/** Stable aggregate family name used in the integration outbox rows. */
export const INVENTORY_AGGREGATE_TYPE = 'Inventory' as const;
