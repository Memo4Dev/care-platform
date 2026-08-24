import { Module } from '@nestjs/common';

import { AppShellModule } from './modules/app-shell/app-shell.module';
import { OrganizationModule } from './modules/organization/organization.module';

@Module({
  imports: [AppShellModule, OrganizationModule],
})
export class AppModule {}
