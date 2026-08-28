import type { CursorPage } from '@commerce-platform/contracts';

import type { CartChannel, CartStatus } from './domain/types';

export type { CartChannel, CartStatus } from './domain/types';

/**
 * Narrow M5-004 read contract for future Sales checkout/conversion use cases.
 * Cart command methods remain inside the Cart context until their consuming
 * workflow is implemented; no cross-context caller receives a repository.
 */
export const CART_CONTRACTS = Symbol('CART_CONTRACTS');

export interface CartItemView {
  readonly id: string;
  readonly organizationId: string;
  readonly cartId: string;
  readonly variantId: string;
  readonly unitId: string;
  readonly quantity: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CartView {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly channel: CartChannel;
  readonly status: CartStatus;
  readonly customerId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly items: readonly CartItemView[];
}

export interface CartContracts {
  getCart(organizationId: string, cartId: string): Promise<CartView | null>;
}

/** Runtime validation for JSON responses restored from the idempotency store. */
export function isCartView(value: unknown): value is CartView {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.organizationId) &&
    isString(value.branchId) &&
    isCartChannel(value.channel) &&
    value.status === 'DRAFT' &&
    (value.customerId === null || isString(value.customerId)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    typeof value.version === 'number' &&
    Number.isSafeInteger(value.version) &&
    value.version >= 1 &&
    Array.isArray(value.items) &&
    value.items.every(isCartItemView)
  );
}

/** Rebuilds the DTO in its canonical property order after JSONB replay. */
export function normalizeCartView(value: unknown): CartView | null {
  if (!isCartView(value)) return null;
  return {
    id: value.id,
    organizationId: value.organizationId,
    branchId: value.branchId,
    channel: value.channel,
    status: value.status,
    customerId: value.customerId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    version: value.version,
    items: value.items.map((item) => ({
      id: item.id,
      organizationId: item.organizationId,
      cartId: item.cartId,
      variantId: item.variantId,
      unitId: item.unitId,
      quantity: item.quantity,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  };
}

function isCartItemView(value: unknown): value is CartItemView {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.organizationId) &&
    isString(value.cartId) &&
    isString(value.variantId) &&
    isString(value.unitId) &&
    isString(value.quantity) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isCartChannel(value: unknown): value is CartChannel {
  return value === 'ONLINE' || value === 'POS' || value === 'SALES';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export type CartPage = CursorPage<CartView>;
