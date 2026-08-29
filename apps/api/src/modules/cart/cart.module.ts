import { Module } from '@nestjs/common';

import { AuthModule } from '../../common/auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CustomersModule } from '../customers/customers.module';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrganizationModule } from '../organization/organization.module';
import { CartContractProvider } from './application/cart-contracts.provider';
import { CartService } from './application/cart.service';
import { CART_CONTRACTS } from './contracts';
import { CartPosController } from './cart-pos.controller';
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
  ],
  controllers: [CartPosController],
  providers: [
    CartRepository,
    CartService,
    CartContractProvider,
    { provide: CART_CONTRACTS, useExisting: CartContractProvider },
  ],
  exports: [CART_CONTRACTS],
})
export class CartModule {}
