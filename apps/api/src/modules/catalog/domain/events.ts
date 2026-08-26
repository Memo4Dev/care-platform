/**
 * Domain events of the Catalog context.
 *
 * Events are plain data: they are collected inside aggregates and persisted to
 * the integration outbox by the repository within the same transaction as the
 * state change. Serialization is JSON; keep payloads free of functions,
 * class instances and sensitive data.
 */

// ---------------------------------------------------------------------------
// Product events
// ---------------------------------------------------------------------------

export interface ProductCreatedEvent {
  readonly type: 'ProductCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly productId: string;
  readonly name: string;
  readonly status: ProductStatus;
}

export interface ProductUpdatedEvent {
  readonly type: 'ProductUpdated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly productId: string;
  readonly name: string;
}

export interface ProductActivatedEvent {
  readonly type: 'ProductActivated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly productId: string;
}

export interface ProductDiscontinuedEvent {
  readonly type: 'ProductDiscontinued';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly productId: string;
}

// ---------------------------------------------------------------------------
// Variant events
// ---------------------------------------------------------------------------

export interface VariantAddedEvent {
  readonly type: 'VariantAdded';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly variantId: string;
  readonly productId: string;
  readonly name: string;
  readonly sku: string;
}

export interface VariantUpdatedEvent {
  readonly type: 'VariantUpdated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly variantId: string;
  readonly productId: string;
  readonly name: string;
}

export interface VariantActivatedEvent {
  readonly type: 'VariantActivated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly variantId: string;
  readonly productId: string;
}

export interface VariantDiscontinuedEvent {
  readonly type: 'VariantDiscontinued';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly variantId: string;
  readonly productId: string;
}

// ---------------------------------------------------------------------------
// Category events
// ---------------------------------------------------------------------------

export interface CategoryCreatedEvent {
  readonly type: 'CategoryCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly categoryId: string;
  readonly name: string;
  readonly parentId: string | null;
}

export interface CategoryUpdatedEvent {
  readonly type: 'CategoryUpdated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly categoryId: string;
  readonly name: string;
}

export interface CategoryDeactivatedEvent {
  readonly type: 'CategoryDeactivated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly categoryId: string;
}

// ---------------------------------------------------------------------------
// Unit events
// ---------------------------------------------------------------------------

export interface UnitCreatedEvent {
  readonly type: 'UnitCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly unitId: string;
  readonly name: string;
  readonly symbol: string;
  readonly isBaseUnit: boolean;
}

// ---------------------------------------------------------------------------
// Packaging events
// ---------------------------------------------------------------------------

export interface PackagingDefinitionCreatedEvent {
  readonly type: 'PackagingDefinitionCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly packagingDefinitionId: string;
  readonly name: string;
  readonly unitId: string;
  readonly parentId: string | null;
  readonly factor: string;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type ProductStatus = 'ACTIVE' | 'DRAFT' | 'DISCONTINUED';
export type VariantStatus = 'ACTIVE' | 'DRAFT' | 'DISCONTINUED';

export type CatalogDomainEvent =
  | ProductCreatedEvent
  | ProductUpdatedEvent
  | ProductActivatedEvent
  | ProductDiscontinuedEvent
  | VariantAddedEvent
  | VariantUpdatedEvent
  | VariantActivatedEvent
  | VariantDiscontinuedEvent
  | CategoryCreatedEvent
  | CategoryUpdatedEvent
  | CategoryDeactivatedEvent
  | UnitCreatedEvent
  | PackagingDefinitionCreatedEvent;

/** Stable aggregate family name used in the integration outbox rows. */
export const CATALOG_AGGREGATE_TYPE = 'Catalog' as const;
