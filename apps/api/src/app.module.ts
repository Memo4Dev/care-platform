import { Module } from '@nestjs/common';

import { AppShellModule } from './modules/app-shell/app-shell.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';

@Module({
  imports: [
    AppShellModule,
    OrganizationModule,
    IdentityModule,
    SubscriptionsModule,
    EntitlementsModule,
  ],
})
export class AppModule {}
