import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { eventDeliveryMetrics } from '../../common/events/event-delivery.metrics';
import { MetricsAccessGuard } from './metrics-access.guard';
import { MetricsService } from './metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  @Header('Content-Type', eventDeliveryMetrics.registry.contentType)
  @UseGuards(MetricsAccessGuard)
  metrics(): Promise<string> {
    return this.metricsService.metrics();
  }
}
