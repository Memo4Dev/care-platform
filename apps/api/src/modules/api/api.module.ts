import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogAdminController } from '../catalog/catalog-admin.controller';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryAdminController } from '../inventory/inventory-admin.controller';
import { OrganizationModule } from '../organization/organization.module';
import { TenantAdminController } from '../organization/tenant-admin.controller';
import { PlatformModule } from '../platform/platform.module';
import { PlatformAdminController } from '../platform/platform-admin.controller';
import { PricingModule } from '../pricing/pricing.module';
import { PricingAdminController } from '../pricing/pricing-admin.controller';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { PurchasingAdminController } from '../purchasing/purchasing-admin.controller';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PlatformModule,
    EntitlementsModule,
    SubscriptionsModule,
    ProvisioningModule,
    OrganizationModule,
    CatalogModule,
    PricingModule,
    InventoryModule,
    PurchasingModule,
    CustomersModule,
    IdentityModule,
  ],
  controllers: [
    PlatformAdminController,
    TenantAdminController,
    CatalogAdminController,
    PricingAdminController,
    InventoryAdminController,
    PurchasingAdminController,
  ],
})
export class ApiModule {}
