import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../modules/database/database.module';
import { PlatformModule } from '../../modules/platform/platform.module';
import { PlatformBearerGuard, TenantBearerGuard } from './http-auth.guards';
import { SupabaseJwtService } from './supabase-jwt.service';

@Module({
  imports: [DatabaseModule, PlatformModule],
  providers: [SupabaseJwtService, PlatformBearerGuard, TenantBearerGuard],
  exports: [SupabaseJwtService, PlatformBearerGuard, TenantBearerGuard],
})
export class AuthModule {}
