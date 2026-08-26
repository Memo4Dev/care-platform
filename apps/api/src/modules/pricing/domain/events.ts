/**
 * Domain events of the Pricing context.
 *
 * Events are plain data: they are collected inside aggregates and persisted to
 * the integration outbox by the repository within the same transaction as the
 * state change. Serialization is JSON; keep payloads free of functions,
 * class instances and sensitive data.
 */

// ---------------------------------------------------------------------------
// PriceBook events
// ---------------------------------------------------------------------------

export interface PriceBookCreatedEvent {
  readonly type: 'PriceBookCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly priceBookId: string;
  readonly name: string;
  readonly isDefault: boolean;
}

export interface PriceBookDefaultChangedEvent {
  readonly type: 'PriceBookDefaultChanged';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly priceBookId: string;
  readonly previousPriceBookId: string | null;
}

export interface PriceBookDeactivatedEvent {
  readonly type: 'PriceBookDeactivated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly priceBookId: string;
}

// ---------------------------------------------------------------------------
// PriceEntry events
// ---------------------------------------------------------------------------

export interface PriceEntryCreatedEvent {
  readonly type: 'PriceEntryCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly priceEntryId: string;
  readonly priceBookId: string;
  readonly variantId: string;
  readonly amount: string;
}

export interface PriceEntryUpdatedEvent {
  readonly type: 'PriceEntryUpdated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly priceEntryId: string;
  readonly priceBookId: string;
  readonly variantId: string;
  readonly amount: string;
}

// ---------------------------------------------------------------------------
// Promotion events
// ---------------------------------------------------------------------------

export interface PromotionCreatedEvent {
  readonly type: 'PromotionCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly promotionId: string;
  readonly name: string;
  readonly promotionType: PromotionType;
}

export interface PromotionDeactivatedEvent {
  readonly type: 'PromotionDeactivated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly promotionId: string;
}

// ---------------------------------------------------------------------------
// Coupon events
// ---------------------------------------------------------------------------

export interface CouponCreatedEvent {
  readonly type: 'CouponCreated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly couponId: string;
  readonly code: string;
}

export interface CouponRedeemedEvent {
  readonly type: 'CouponRedeemed';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly couponId: string;
  readonly code: string;
  readonly usedCount: number;
}

export interface CouponDeactivatedEvent {
  readonly type: 'CouponDeactivated';
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly couponId: string;
  readonly code: string;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type PriceType = 'CASH' | 'WHOLESALE' | 'CREDIT' | 'ONLINE';
export type Channel = 'POS' | 'ONLINE' | 'MOBILE' | 'WHOLESALE';
export type PromotionType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'BUY_X_GET_Y';
export type PromotionTarget = 'PRODUCT' | 'VARIANT' | 'CATEGORY' | 'ORDER';

export type PricingDomainEvent =
  | PriceBookCreatedEvent
  | PriceBookDefaultChangedEvent
  | PriceBookDeactivatedEvent
  | PriceEntryCreatedEvent
  | PriceEntryUpdatedEvent
  | PromotionCreatedEvent
  | PromotionDeactivatedEvent
  | CouponCreatedEvent
  | CouponRedeemedEvent
  | CouponDeactivatedEvent;

/** Stable aggregate family name used in the integration outbox rows. */
export const PRICING_AGGREGATE_TYPE = 'Pricing' as const;
