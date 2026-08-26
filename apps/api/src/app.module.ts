import { Module } from '@nestjs/common';

import { AppShellModule } from './modules/app-shell/app-shell.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PlatformModule } from './modules/platform/platform.module';
import { ProvisioningModule } from './modules/provisioning/provisioning.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { ApiModule } from './modules/api/api.module';

@Module({
  imports: [
    AppShellModule,
    OrganizationModule,
    CatalogModule,
    IdentityModule,
    SubscriptionsModule,
    EntitlementsModule,
    PlatformModule,
    ProvisioningModule,
    PricingModule,
    ApiModule,
  ],
})
export class AppModule {}
