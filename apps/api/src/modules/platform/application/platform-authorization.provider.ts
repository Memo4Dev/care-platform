import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { PlatformError } from '@commerce-platform/contracts';
import type { DatabaseClient, PlatformCapability } from '@commerce-platform/database';
import {
  platformCapabilities,
  platformPrincipalRoles,
  platformPrincipals,
  platformRoleCapabilities,
} from '@commerce-platform/database';
import { DATABASE } from '../../database/database.tokens';
import { assertTrustedPrincipal } from './authenticated-principal.provider';
import type { PlatformUserPrincipal } from '../../../common/auth/authenticated-principal';

export const PLATFORM_AUTHORIZATION = Symbol('PLATFORM_AUTHORIZATION');
export interface PlatformPrincipalContext {
  principal: PlatformUserPrincipal;
  correlationId: string;
  causationId: string;
}
export interface PlatformAuthorizationProvider {
  requireCapability(
    principal: PlatformPrincipalContext,
    capability: PlatformCapability,
  ): Promise<void>;
}
/** Database is the authorization source of truth; roles never arrive from a caller command. */
@Injectable()
export class DatabasePlatformAuthorizationProvider implements PlatformAuthorizationProvider {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}
  async requireCapability(
    principal: PlatformPrincipalContext,
    capability: PlatformCapability,
  ): Promise<void> {
    if (
      (() => {
        try {
          assertTrustedPrincipal(principal.principal);
          return false;
        } catch {
          return true;
        }
      })() ||
      principal.principal.type !== 'PLATFORM_USER'
    )
      throw PlatformError.permissionDenied('Platform principal required.');
    const [allowed] = await this.db
      .select({ id: platformPrincipals.id })
      .from(platformPrincipals)
      .innerJoin(
        platformPrincipalRoles,
        eq(platformPrincipalRoles.principalId, platformPrincipals.id),
      )
      .innerJoin(
        platformRoleCapabilities,
        eq(platformRoleCapabilities.roleId, platformPrincipalRoles.roleId),
      )
      .innerJoin(
        platformCapabilities,
        eq(platformCapabilities.id, platformRoleCapabilities.capabilityId),
      )
      .where(
        and(
          eq(platformPrincipals.id, principal.principal.platformUserId),
          eq(platformPrincipals.status, 'ACTIVE'),
          eq(platformCapabilities.code, capability),
        ),
      )
      .limit(1);
    if (!allowed) throw PlatformError.permissionDenied('Platform permission denied.');
  }
}
