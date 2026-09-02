import { Inject, Injectable } from '@nestjs/common';

import type {
  CartCheckoutContracts,
  CartCheckoutHoldView,
  CartCheckoutView,
  CartContracts,
  CartItemView,
  CartView,
} from '../contracts';
import { CartService } from './cart.service';
import { CartRepository } from '../infrastructure/cart.repository';
import type { DbExecutor } from '../infrastructure/db-executor';
import { PlatformError } from '@commerce-platform/contracts';
import type { CartRecord } from '../infrastructure/cart.repository';
import type { CartHoldRow } from '@commerce-platform/database';

@Injectable()
export class CartContractProvider implements CartContracts, CartCheckoutContracts {
  constructor(
    @Inject(CartService) private readonly carts: CartService,
    @Inject(CartRepository) private readonly repository: CartRepository,
  ) {}

  async getCart(organizationId: string, cartId: string): Promise<CartView | null> {
    return this.carts.get(organizationId, cartId);
  }

  async lockDraftCartForCheckout(
    executor: DbExecutor,
    organizationId: string,
    cartId: string,
  ): Promise<CartCheckoutView | null> {
    const record = await this.repository.findDraftCartForCheckout(executor, organizationId, cartId);
    if (!record) return null;
    const hold = await this.repository.findCurrentHold(executor, organizationId, cartId);
    return toCartView(record, hold);
  }

  async markCartCheckedOut(
    executor: DbExecutor,
    input: { organizationId: string; cartId: string; expectedVersion: number; holdId?: string },
  ): Promise<CartView> {
    const updated = await this.repository.markCheckedOut(
      executor,
      input.organizationId,
      input.cartId,
      input.expectedVersion,
    );
    if (!updated) {
      throw PlatformError.versionConflict(`Cart ${input.cartId} was modified concurrently.`, {
        details: { cartId: input.cartId, expectedVersion: input.expectedVersion },
      });
    }
    if (input.holdId) {
      await this.repository.markHoldCheckedOut(executor, input.organizationId, input.holdId);
    }
    const record = await this.repository.findCartAnyStatus(
      executor,
      input.organizationId,
      input.cartId,
    );
    if (!record) {
      throw PlatformError.notFound('Cart was not found.', { details: { cartId: input.cartId } });
    }
    const hold = await this.repository.findCurrentHold(
      executor,
      input.organizationId,
      input.cartId,
    );
    return toCartView(record, hold);
  }
}

function toCartView(record: CartRecord, hold: CartHoldRow | null): CartCheckoutView {
  return {
    id: record.cart.id,
    organizationId: record.cart.organizationId,
    branchId: record.cart.branchId,
    channel: record.cart.channel,
    status: record.cart.status,
    customerId: record.cart.customerId,
    createdAt: record.cart.createdAt.toISOString(),
    updatedAt: record.cart.updatedAt.toISOString(),
    version: record.cart.version,
    items: record.lines.map(toCartItemView),
    hold: toCartHoldView(hold),
  };
}

function toCartItemView(line: CartRecord['lines'][number]): CartItemView {
  return {
    id: line.id,
    organizationId: line.organizationId,
    cartId: line.cartId,
    variantId: line.variantId,
    unitId: line.unitId,
    quantity: line.quantity,
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
  };
}

function toCartHoldView(hold: CartHoldRow | null): CartCheckoutHoldView | null {
  if (!hold) return null;
  return {
    id: hold.id,
    status: hold.status,
    warehouseId: hold.warehouseId,
    inventoryReservationId: hold.inventoryReservationId ?? null,
    cartVersion: hold.cartVersion,
    ttlMinutes: hold.ttlMinutes,
    policyVersion: hold.policyVersion,
    expiresAt: hold.expiresAt?.toISOString() ?? null,
    shortages: Array.isArray(hold.shortagesJson) ? (hold.shortagesJson as never[]) : [],
  };
}
