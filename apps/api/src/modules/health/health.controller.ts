import { Controller, Get } from '@nestjs/common';

import type { HealthResponse } from '../../common/types/health-response';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'api-shell',
      timestamp: new Date().toISOString(),
    };
  }
}
