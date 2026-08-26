import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogAdminController } from '../catalog/catalog-admin.controller';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationModule } from '../organization/organization.module';
import { TenantAdminController } from '../organization/tenant-admin.controller';
import { PlatformModule } from '../platform/platform.module';
import { PlatformAdminController } from '../platform/platform-admin.controller';
import { ProvisioningModule } from '../provisioning/provisioning.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

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
    IdentityModule,
  ],
  controllers: [PlatformAdminController, TenantAdminController, CatalogAdminController],
})
export class ApiModule {}
