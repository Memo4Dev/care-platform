import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { DatabaseClient } from '@commerce-platform/database';
import { platformPrincipals } from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import type {
  AuthenticatedPrincipal,
  PlatformUserPrincipal,
  SystemServicePrincipal,
} from '../../../common/auth/authenticated-principal';
import { DATABASE } from '../../database/database.tokens';
const registry = new WeakSet<object>();
function trust<T extends AuthenticatedPrincipal>(principal: T): T {
  registry.add(principal);
  return Object.freeze(principal);
}
export function assertTrustedPrincipal(value: unknown): asserts value is AuthenticatedPrincipal {
  if (!value || typeof value !== 'object' || !registry.has(value))
    throw PlatformError.permissionDenied('Trusted authenticated principal required.');
}
export interface PlatformPrincipalResolver {
  resolveVerifiedSupabaseSubject(subject: string): Promise<PlatformUserPrincipal>;
}
export const PLATFORM_PRINCIPAL_RESOLVER = Symbol('PLATFORM_PRINCIPAL_RESOLVER');
@Injectable()
export class DatabasePlatformPrincipalResolver implements PlatformPrincipalResolver {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}
  async resolveVerifiedSupabaseSubject(subject: string): Promise<PlatformUserPrincipal> {
    const [principal] = await this.db
      .select({ id: platformPrincipals.id })
      .from(platformPrincipals)
      .where(eq(platformPrincipals.supabaseUserId, subject))
      .limit(1);
    if (!principal) throw PlatformError.permissionDenied('Platform principal is not active.');
    return trust({
      type: 'PLATFORM_USER',
      subjectId: subject,
      platformUserId: principal.id,
    } as PlatformUserPrincipal);
  }
}
export interface ProvisioningSystemPrincipalProvider {
  getProvisioningPrincipal(): SystemServicePrincipal;
}
export const PROVISIONING_SYSTEM_PRINCIPAL = Symbol('PROVISIONING_SYSTEM_PRINCIPAL');
@Injectable()
export class FixedProvisioningSystemPrincipalProvider implements ProvisioningSystemPrincipalProvider {
  private readonly principal = trust({
    type: 'SYSTEM_SERVICE',
    subjectId: 'SYSTEM:tenant-provisioning',
  } as SystemServicePrincipal);
  getProvisioningPrincipal() {
    return this.principal;
  }
}
