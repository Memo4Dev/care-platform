import { Module } from '@nestjs/common';

import { AppShellModule } from './modules/app-shell/app-shell.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';

@Module({
  imports: [AppShellModule, OrganizationModule, IdentityModule, EntitlementsModule],
})
export class AppModule {}
