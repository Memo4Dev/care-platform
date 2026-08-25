import type { ExecutionContext } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetricsAccessGuard } from './metrics-access.guard';

function contextFor(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext;
}

describe('MetricsAccessGuard', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('fails closed when the Prometheus credential is not configured', () => {
    vi.stubEnv('METRICS_BEARER_TOKEN', '');

    expect(() => new MetricsAccessGuard().canActivate(contextFor('Bearer valid-token'))).toThrow(
      'Authentication required.',
    );
  });

  it('rejects missing and incorrect bearer credentials', () => {
    vi.stubEnv('METRICS_BEARER_TOKEN', 'prometheus-secret');
    const guard = new MetricsAccessGuard();

    expect(() => guard.canActivate(contextFor())).toThrow('Authentication required.');
    expect(() => guard.canActivate(contextFor('Bearer wrong-secret'))).toThrow(
      'Authentication required.',
    );
  });

  it('permits only the configured Prometheus bearer credential', () => {
    vi.stubEnv('METRICS_BEARER_TOKEN', 'prometheus-secret');

    expect(new MetricsAccessGuard().canActivate(contextFor('Bearer prometheus-secret'))).toBe(true);
  });
});
