import { createHash, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { PlatformError } from '@commerce-platform/contracts';

interface MetricsRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Prometheus is an infrastructure principal, not an application user. The
 * endpoint is deliberately unavailable until its dedicated credential exists.
 */
@Injectable()
export class MetricsAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<MetricsRequest>();
    const configuredToken = process.env.METRICS_BEARER_TOKEN;
    const authorization = request.headers.authorization;

    if (
      !configuredToken?.trim() ||
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ') ||
      !safeTokenEquals(authorization.slice('Bearer '.length), configuredToken)
    ) {
      throw PlatformError.authenticationRequired();
    }

    return true;
  }
}

function safeTokenEquals(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}
