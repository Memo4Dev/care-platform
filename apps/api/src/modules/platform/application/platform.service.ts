import { Inject, Injectable } from '@nestjs/common';
import { newId, type PlatformCapability } from '@commerce-platform/database';
import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import { DATABASE } from '../../database/database.tokens';
import type { DatabaseClient } from '@commerce-platform/database';
import { PlatformTenant } from '../domain/platform-tenant';
import {
  PlatformTenantRepository,
  type PlatformAuditContext,
} from '../infrastructure/platform-tenant.repository';
import type { DbExecutor } from '../infrastructure/db-executor';
import {
  PLATFORM_AUTHORIZATION,
  type PlatformAuthorizationProvider,
  type PlatformPrincipalContext,
} from './platform-authorization.provider';
import {
  PLATFORM_REGISTRATION_RESOLVER,
  UnavailablePlatformRegistrationResolver,
  type PlatformRegistrationResolver,
} from './platform-registration.contract';

type CommandAudit = PlatformPrincipalContext;
@Injectable()
export class PlatformService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(PlatformTenantRepository) private readonly repository: PlatformTenantRepository,
    @Inject(PLATFORM_AUTHORIZATION) private readonly authorization: PlatformAuthorizationProvider,
    @Inject(PLATFORM_REGISTRATION_RESOLVER)
    private readonly registrations: PlatformRegistrationResolver = new UnavailablePlatformRegistrationResolver(),
  ) {}
  async register(
    c: {
      tenantId?: string;
      registrationReference: string;
      subscriptionId?: string | null;
      subscriptionVersion?: number | null;
    } & CommandAudit,
  ) {
    return this.db.transaction((tx) => this.registerInTransaction(tx, c));
  }
  async registerInTransaction(
    tx: DbExecutor,
    c: {
      tenantId?: string;
      registrationReference: string;
      subscriptionId?: string | null;
      subscriptionVersion?: number | null;
    } & CommandAudit,
    tenant?: PlatformTenant,
    registration?: Awaited<ReturnType<PlatformRegistrationResolver['resolveTrustedRegistration']>>,
  ) {
    await this.authorization.requireCapability(c, 'tenant.suspend');
    const resolvedRegistration =
      registration ??
      (await this.registrations.resolveTrustedRegistration(c.registrationReference));
    const resolvedTenant =
      tenant ??
      PlatformTenant.register({
        id: c.tenantId ?? newId(),
        organizationId: resolvedRegistration.organizationId,
        subscriptionId: c.subscriptionId,
        subscriptionVersion: c.subscriptionVersion,
      });
    return {
      tenant: snapshot(resolvedTenant),
      eventsPersisted: await this.repository.save(
        tx,
        resolvedTenant,
        audit(c),
        resolvedRegistration,
      ),
    };
  }
  async activate(c: { tenantId: string } & CommandAudit) {
    return this.execute(c, 'tenant.suspend', (t) => t.activate());
  }
  async suspend(c: { tenantId: string; reason: string } & CommandAudit) {
    return this.execute(c, 'tenant.suspend', (t) => t.suspend(c.reason));
  }
  async reactivate(c: { tenantId: string } & CommandAudit) {
    return this.execute(c, 'tenant.suspend', (t) => t.reactivate());
  }
  async close(c: { tenantId: string } & CommandAudit) {
    return this.execute(c, 'tenant.suspend', (t) => t.close());
  }
  async requestSupport(
    c: { tenantId: string; reason: string; expiresAt: Date; sessionId?: string } & CommandAudit,
  ) {
    return this.execute(c, 'support.session', (t) =>
      t.requestSupport({
        id: c.sessionId ?? newId(),
        reason: c.reason,
        requestedByPlatformUserId: c.principal.platformUserId,
        expiresAt: c.expiresAt,
      }),
    );
  }
  async startSupport(c: { tenantId: string; sessionId: string } & CommandAudit) {
    return this.execute(c, 'support.session', (t) =>
      t.startSupport(c.sessionId, c.principal.platformUserId),
    );
  }
  async endSupport(c: { tenantId: string; sessionId: string; reason?: string } & CommandAudit) {
    return this.execute(c, 'support.session', (t) =>
      t.endSupport(c.sessionId, c.principal.platformUserId, c.reason),
    );
  }
  async assertOperatorBoundActiveSupportSession(
    c: PlatformPrincipalContext & { organizationId: string; supportSessionId: string; now?: Date },
  ) {
    await this.authorization.requireCapability(c, 'support.session');
    const result = await this.db.transaction(async (tx) => {
      const tenant = await this.repository.findByOrganization(
        tx,
        c.organizationId,
        () => c.now ?? new Date(),
      );
      if (!tenant) throw PlatformError.notFound('Platform tenant was not found.');
      const session = tenant.sessions.find((entry) => entry.id === c.supportSessionId);
      if (!session || session.requestedByPlatformUserId !== c.principal.platformUserId)
        throw PlatformError.permissionDenied('Support session is not bound to this platform user.');
      tenant.expireSupportSessions();
      if (tenant.hasPendingChanges)
        await this.repository.save(tx, tenant, {
          actorId: c.principal.platformUserId,
          correlationId: c.correlationId,
          causationId: c.causationId,
        });
      const active = tenant.sessions.find((entry) => entry.id === c.supportSessionId);
      return { active: active?.status === 'ACTIVE', sessionId: active?.id };
    });
    if (!result.active)
      throw PlatformError.of(ERROR_CODES.OPERATION_NOT_ALLOWED, 'Support session is not active.');
    return {
      organizationId: c.organizationId,
      supportSessionId: result.sessionId!,
      platformUserId: c.principal.platformUserId,
    };
  }
  private async execute(
    c: { tenantId: string } & CommandAudit,
    permission: PlatformCapability,
    action: (tenant: PlatformTenant) => void,
  ) {
    return this.db.transaction((tx) => this.executeInTransaction(tx, c, permission, action));
  }
  async executeInTransaction(
    tx: DbExecutor,
    c: { tenantId: string } & CommandAudit,
    permission: PlatformCapability,
    action: (tenant: PlatformTenant) => void,
  ) {
    await this.authorization.requireCapability(c, permission);
    const tenant = await this.repository.find(tx, c.tenantId);
    if (!tenant) throw PlatformError.notFound(`Platform tenant ${c.tenantId} was not found.`);
    action(tenant);
    return {
      tenant: snapshot(tenant),
      eventsPersisted: await this.repository.save(tx, tenant, audit(c)),
    };
  }
}
function audit(c: PlatformPrincipalContext): PlatformAuditContext {
  return {
    actorId: c.principal.platformUserId,
    correlationId: c.correlationId,
    causationId: c.causationId,
  };
}
function snapshot(t: PlatformTenant) {
  return {
    id: t.id,
    organizationId: t.organizationId,
    status: t.status,
    provisioningStatus: t.provisioningStatus,
    version: t.version,
  };
}
