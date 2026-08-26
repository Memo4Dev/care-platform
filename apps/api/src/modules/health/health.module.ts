import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { HealthController } from './health.controller';
import { MetricsAccessGuard } from './metrics-access.guard';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, MetricsController],
  providers: [MetricsAccessGuard, MetricsService],
})
export class HealthModule {}
