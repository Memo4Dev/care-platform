import type { CartChannel } from './types';

export const CART_AGGREGATE_TYPE = 'Cart';

export interface CartCreatedEvent {
  type: 'CartCreated';
  occurredAt: Date;
  organizationId: string;
  aggregateId: string;
  aggregateVersion: number;
  branchId: string;
  channel: CartChannel;
  customerId: string | null;
}

export interface CartLineAddedEvent {
  type: 'CartLineAdded';
  occurredAt: Date;
  organizationId: string;
  aggregateId: string;
  aggregateVersion: number;
  lineId: string;
  variantId: string;
  unitId: string;
  quantity: string;
}

export interface CartLineUpdatedEvent {
  type: 'CartLineUpdated';
  occurredAt: Date;
  organizationId: string;
  aggregateId: string;
  aggregateVersion: number;
  lineId: string;
  quantity: string;
}

export interface CartLineRemovedEvent {
  type: 'CartLineRemoved';
  occurredAt: Date;
  organizationId: string;
  aggregateId: string;
  aggregateVersion: number;
  lineId: string;
}

export type CartDomainEvent =
  CartCreatedEvent | CartLineAddedEvent | CartLineUpdatedEvent | CartLineRemovedEvent;
