import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  trustPrincipal,
  type OrganizationUserPrincipal,
  type PlatformUserPrincipal,
} from './authenticated-principal';
import { type AuthenticatedRequest, PosOperatorGuard, TenantBearerGuard } from './http-auth.guards';

describe('PosOperatorGuard', () => {
  it('delegates tenant authentication and accepts its trusted organization user', async () => {
    const request: AuthenticatedRequest = { headers: {} };
    const context = executionContext(request);
    const canActivate = vi.fn(async () => {
      request.principal = trustPrincipal({
        type: 'ORGANIZATION_USER',
        subjectId: 'subject-1',
        organizationUserId: 'user-1',
        organizationId: 'organization-1',
      } as OrganizationUserPrincipal);
      return true;
    });
    const guard = new PosOperatorGuard({ canActivate } as unknown as TenantBearerGuard);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(canActivate).toHaveBeenCalledOnce();
    expect(canActivate).toHaveBeenCalledWith(context);
  });

  it('rejects a structurally valid organization user not produced by a trusted provider', async () => {
    const request: AuthenticatedRequest = { headers: {} };
    const context = executionContext(request);
    const canActivate = vi.fn(async () => {
      request.principal = {
        type: 'ORGANIZATION_USER',
        subjectId: 'subject-1',
        organizationUserId: 'user-1',
        organizationId: 'organization-1',
      } as unknown as OrganizationUserPrincipal;
      return true;
    });
    const guard = new PosOperatorGuard({ canActivate } as unknown as TenantBearerGuard);

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Trusted authenticated principal required.',
    );
  });

  it('rejects a trusted non-organization principal returned by the delegate', async () => {
    const request: AuthenticatedRequest = { headers: {} };
    const context = executionContext(request);
    const canActivate = vi.fn(async () => {
      request.principal = trustPrincipal({
        type: 'PLATFORM_USER',
        subjectId: 'subject-1',
        platformUserId: 'platform-user-1',
      } as PlatformUserPrincipal);
      return true;
    });
    const guard = new PosOperatorGuard({ canActivate } as unknown as TenantBearerGuard);

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Trusted organization-user principal required.',
    );
  });
});

function executionContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}
