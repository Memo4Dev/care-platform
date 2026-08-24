import { Module } from '@nestjs/common';

import { AppShellModule } from './modules/app-shell/app-shell.module';

@Module({
  imports: [AppShellModule],
})
export class AppModule {}
