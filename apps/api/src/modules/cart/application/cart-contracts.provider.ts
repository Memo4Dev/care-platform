import { Inject, Injectable } from '@nestjs/common';

import type { CartContracts, CartView } from '../contracts';
import { CartService } from './cart.service';

@Injectable()
export class CartContractProvider implements CartContracts {
  constructor(@Inject(CartService) private readonly carts: CartService) {}

  async getCart(organizationId: string, cartId: string): Promise<CartView | null> {
    return this.carts.get(organizationId, cartId);
  }
}
