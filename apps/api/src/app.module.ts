import { Module } from '@nestjs/common';

import { AppShellModule } from './modules/app-shell/app-shell.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { PlatformModule } from './modules/platform/platform.module';
import { ProvisioningModule } from './modules/provisioning/provisioning.module';

@Module({
  imports: [
    AppShellModule,
    OrganizationModule,
    IdentityModule,
    SubscriptionsModule,
    EntitlementsModule,
    PlatformModule,
    ProvisioningModule,
  ],
})
export class AppModule {}
