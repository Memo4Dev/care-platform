import { Module } from '@nestjs/common';

import { AuthModule } from '../../common/auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CartModule } from '../cart/cart.module';
import { CustomersModule } from '../customers/customers.module';
import { DatabaseModule } from '../database/database.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PricingModule } from '../pricing/pricing.module';
import { SALES_CONTRACTS } from './contracts';
import { SalesContractsProvider } from './application/sales-contracts.provider';
import { SalesService } from './application/sales.service';
import { SalesRepository } from './infrastructure/sales.repository';
import { SalesInternalController } from './sales-internal.controller';
import { InternalSalesCompletionGuard } from './internal-sales-completion.guard';
import { SalesPosController } from './sales-pos.controller';

@Module({
  imports: [
    AuthModule,
    CatalogModule,
    CartModule,
    CustomersModule,
    DatabaseModule,
    IdentityModule,
    InventoryModule,
    PricingModule,
  ],
  controllers: [SalesPosController, SalesInternalController],
  providers: [
    SalesRepository,
    SalesService,
    SalesContractsProvider,
    InternalSalesCompletionGuard,
    { provide: SALES_CONTRACTS, useExisting: SalesContractsProvider },
  ],
  exports: [SALES_CONTRACTS],
})
export class SalesModule {}
