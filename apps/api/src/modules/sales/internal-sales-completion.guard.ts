import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { PlatformError } from '@commerce-platform/contracts';

import {
  trustPrincipal,
  type SystemServicePrincipal,
} from '../../common/auth/authenticated-principal';
import type { AuthenticatedRequest } from '../../common/auth/http-auth.guards';

interface InternalTokenPayload {
  sub: string;
  org: string;
  exp: number;
}

@Injectable()
export class InternalSalesCompletionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const configuredToken = process.env.SALES_INTERNAL_BEARER_TOKEN;
    const authorization = request.headers.authorization;

    if (
      !configuredToken?.trim() ||
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ')
    ) {
      throw PlatformError.authenticationRequired();
    }

    const payload = verifyInternalToken(authorization.slice('Bearer '.length), configuredToken);
    request.principal = trustPrincipal({
      type: 'SYSTEM_SERVICE',
      subjectId: payload.sub,
    } as SystemServicePrincipal);
    request.internalOrganizationId = payload.org;

    return true;
  }
}

function verifyInternalToken(token: string, secret: string): InternalTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw PlatformError.authenticationRequired();
  const [header, payload, signature] = parts;
  const input = `${header}.${payload}`;
  const expectedSignature = createHmac('sha256', secret).update(input).digest('base64url');
  if (!safeTokenEquals(signature, expectedSignature)) throw PlatformError.authenticationRequired();

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw PlatformError.authenticationRequired();
  }

  if (
    !decoded ||
    typeof decoded !== 'object' ||
    typeof (decoded as InternalTokenPayload).sub !== 'string' ||
    typeof (decoded as InternalTokenPayload).org !== 'string' ||
    typeof (decoded as InternalTokenPayload).exp !== 'number' ||
    (decoded as InternalTokenPayload).exp <= Math.floor(Date.now() / 1000)
  ) {
    throw PlatformError.authenticationRequired();
  }

  return decoded as InternalTokenPayload;
}

function safeTokenEquals(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}
