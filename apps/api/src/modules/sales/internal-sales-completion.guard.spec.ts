import type { ExecutionContext } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InternalSalesCompletionGuard } from './internal-sales-completion.guard';

function token(secret: string, org = '01900000-0000-7000-8000-000000000001', exp?: number) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'SYSTEM:sales-internal-completion',
      org,
      exp: exp ?? Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}

function contextFor(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext;
}

describe('InternalSalesCompletionGuard', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('fails closed when the internal credential is not configured', () => {
    vi.stubEnv('SALES_INTERNAL_BEARER_TOKEN', '');

    expect(() =>
      new InternalSalesCompletionGuard().canActivate(contextFor('Bearer valid-token')),
    ).toThrow('Authentication required.');
  });

  it('rejects missing and incorrect bearer credentials', () => {
    vi.stubEnv('SALES_INTERNAL_BEARER_TOKEN', 'sales-secret');
    const guard = new InternalSalesCompletionGuard();

    expect(() => guard.canActivate(contextFor())).toThrow('Authentication required.');
    expect(() => guard.canActivate(contextFor(`Bearer ${token('wrong-secret')}`))).toThrow(
      'Authentication required.',
    );
  });

  it('permits only the configured internal bearer credential', () => {
    vi.stubEnv('SALES_INTERNAL_BEARER_TOKEN', 'sales-secret');

    expect(
      new InternalSalesCompletionGuard().canActivate(contextFor(`Bearer ${token('sales-secret')}`)),
    ).toBe(true);
  });
});
