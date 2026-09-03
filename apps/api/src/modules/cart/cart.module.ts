import { Module } from '@nestjs/common';

import { AuthModule } from '../../common/auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrganizationModule } from '../organization/organization.module';
import { PricingModule } from '../pricing/pricing.module';
import { CartContractProvider } from './application/cart-contracts.provider';
import { CartService } from './application/cart.service';
import { CART_CHECKOUT_CONTRACTS, CART_CONTRACTS } from './contracts';
import { CartPosController } from './cart-pos.controller';
import { PosProductController } from './pos-product.controller';
import { CartRepository } from './infrastructure/cart.repository';

@Module({
  imports: [
    AuthModule,
    CatalogModule,
    CustomersModule,
    DatabaseModule,
    IdentityModule,
    InventoryModule,
    OrganizationModule,
    PricingModule,
  ],
  controllers: [CartPosController, PosProductController],
  providers: [
    CartRepository,
    CartService,
    CartContractProvider,
    { provide: CART_CONTRACTS, useExisting: CartContractProvider },
    { provide: CART_CHECKOUT_CONTRACTS, useExisting: CartContractProvider },
  ],
  exports: [CART_CONTRACTS, CART_CHECKOUT_CONTRACTS],
})
export class CartModule {}
