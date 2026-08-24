import { describe, expect, it } from 'vitest';

import { createApp } from './main';

describe('API bootstrap', () => {
  it('creates an app with Fastify adapter', async () => {
    const app = await createApp();

    await app.init();

    expect(app.getHttpAdapter().getType()).toBe('fastify');

    await app.close();
  });
});
