import { describe, expect, it } from 'vitest';
import { readRedisConfig } from './delivery-config';

describe('readRedisConfig', () => {
  it('requires Redis ACL username and password outside the explicit test exception', () => {
    expect(() => readRedisConfig({ REDIS_HOST: 'redis' })).toThrow('REDIS_USERNAME is required');
    expect(() => readRedisConfig({ REDIS_HOST: 'redis', REDIS_USERNAME: 'relay' })).toThrow(
      'REDIS_PASSWORD is required',
    );
  });

  it('allows missing ACL credentials only with the explicit test-only switch', () => {
    expect(
      readRedisConfig({
        NODE_ENV: 'test',
        REDIS_TEST_ALLOW_UNAUTHENTICATED: 'true',
        REDIS_HOST: 'redis',
      }),
    ).toMatchObject({ host: 'redis', port: 6379, db: 0 });
  });

  it('passes ACL credentials to BullMQ without exposing them in validation errors', () => {
    expect(
      readRedisConfig({
        REDIS_HOST: 'redis',
        REDIS_USERNAME: 'relay',
        REDIS_PASSWORD: 'not-logged',
      }),
    ).toMatchObject({ username: 'relay', password: 'not-logged' });
  });
});
