import { afterEach, describe, expect, it } from 'vitest';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { createApp } from './main';

describe('GET /health', () => {
  let app: NestFastifyApplication | null = null;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('returns shell-safe health payload without external dependencies', async () => {
    app = await createApp();
    await app.init();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      service: string;
      status: string;
      timestamp: string;
    };

    expect(body.status).toBe('ok');
    expect(body.service).toBe('api-shell');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});
