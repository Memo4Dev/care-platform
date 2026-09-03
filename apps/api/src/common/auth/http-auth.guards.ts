import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import { eq } from 'drizzle-orm';
import { platformTenants, users, type DatabaseClient } from '@commerce-platform/database';
import {
  assertTrustedOrganizationUserPrincipal,
  trustPrincipal,
  type AuthenticatedPrincipal,
  type OrganizationUserPrincipal,
} from './authenticated-principal';
import { SupabaseJwtService } from './supabase-jwt.service';
import { DATABASE } from '../../modules/database/database.tokens';
import {
  PLATFORM_PRINCIPAL_RESOLVER,
  type PlatformPrincipalResolver,
} from '../../modules/platform/application/authenticated-principal.provider';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  principal?: AuthenticatedPrincipal;
  correlationId?: string;
  internalOrganizationId?: string;
}

abstract class BearerGuard {
  constructor(protected readonly jwt: SupabaseJwtService) {}
  abstract audienceEnv: 'SUPABASE_PLATFORM_AUDIENCE' | 'SUPABASE_TENANT_AUDIENCE';
  protected async subject(request: AuthenticatedRequest) {
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string' || !authorization.startsWith('Bearer '))
      throw PlatformError.authenticationRequired();
    const audience = process.env[this.audienceEnv];
    if (!audience)
      throw PlatformError.invalidCredentials('Token audience verification is not configured.');
    return this.jwt.verify(authorization.slice(7), audience);
  }
}
@Injectable()
export class PlatformBearerGuard extends BearerGuard {
  readonly audienceEnv = 'SUPABASE_PLATFORM_AUDIENCE' as const;
  constructor(
    @Inject(SupabaseJwtService) jwt: SupabaseJwtService,
    @Inject(PLATFORM_PRINCIPAL_RESOLVER) private readonly principals: PlatformPrincipalResolver,
  ) {
    super(jwt);
  }
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.principal = await this.principals.resolveVerifiedSupabaseSubject(
      await this.subject(request),
    );
    return true;
  }
}
@Injectable()
export class TenantBearerGuard extends BearerGuard {
  readonly audienceEnv = 'SUPABASE_TENANT_AUDIENCE' as const;
  constructor(
    @Inject(SupabaseJwtService) jwt: SupabaseJwtService,
    @Inject(DATABASE) private readonly db: DatabaseClient,
  ) {
    super(jwt);
  }
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const subject = await this.subject(request);
    const [user] = await this.db
      .select({ id: users.id, organizationId: users.organizationId, status: users.status })
      .from(users)
      .where(eq(users.supabaseUserId, subject))
      .limit(1);
    if (!user || user.status !== 'ACTIVE')
      throw PlatformError.permissionDenied('Organization principal is not active.');
    const [tenant] = await this.db
      .select({
        status: platformTenants.status,
        provisioningStatus: platformTenants.provisioningStatus,
      })
      .from(platformTenants)
      .where(eq(platformTenants.organizationId, user.organizationId))
      .limit(1);
    if (!tenant || tenant.provisioningStatus !== 'COMPLETED')
      throw PlatformError.of(
        ERROR_CODES.TENANT_PROVISIONING_INCOMPLETE,
        'Tenant provisioning is incomplete.',
      );
    if (tenant.status !== 'ACTIVE')
      throw PlatformError.tenantSuspended('Tenant business access is unavailable.');
    request.principal = trustPrincipal({
      type: 'ORGANIZATION_USER',
      subjectId: subject,
      organizationUserId: user.id,
      organizationId: user.organizationId,
    } as OrganizationUserPrincipal);
    return true;
  }
}

/**
 * M5 POS authentication seam.
 *
 * The current online path delegates authentication and tenant lifecycle checks
 * to TenantBearerGuard, then requires its trusted organization-user principal.
 * It deliberately proves no POS device, Card/PIN, or offline operator state.
 */
@Injectable()
export class PosOperatorGuard {
  constructor(@Inject(TenantBearerGuard) private readonly tenantBearerGuard: TenantBearerGuard) {}

  async canActivate(context: ExecutionContext) {
    const allowed = await this.tenantBearerGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    assertTrustedOrganizationUserPrincipal(request.principal);
    return allowed;
  }
}
