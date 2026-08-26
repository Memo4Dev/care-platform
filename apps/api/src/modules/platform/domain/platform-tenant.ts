import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import type {
  PlatformTenantStatus,
  ProvisioningStatus,
  SupportSessionStatus,
} from '@commerce-platform/database';
import type { PlatformTenantDomainEvent, PlatformTenantEventType } from './events';

export interface SupportSessionState {
  id: string;
  status: SupportSessionStatus;
  reason: string;
  requestedByPlatformUserId: string;
  startedByPlatformUserId: string | null;
  endedByPlatformUserId: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  expiresAt: Date;
  endedAt: Date | null;
  endReason: string | null;
  version: number;
}
const SUPPORT_EXPIRY_SYSTEM_PRINCIPAL_ID = '00000000-0000-7000-8000-000000000021';
export class PlatformTenant {
  private readonly events: PlatformTenantDomainEvent[] = [];
  private readonly newSessions: SupportSessionState[] = [];
  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _status: PlatformTenantStatus,
    private _provisioningStatus: ProvisioningStatus,
    private _subscriptionId: string | null,
    private _subscriptionVersion: number | null,
    private _suspendedReason: string | null,
    private _expectedVersion: number,
    private _version: number,
    private isNew: boolean,
    readonly sessions: SupportSessionState[],
    private readonly clock: () => Date,
  ) {}
  static register(
    input: {
      id: string;
      organizationId: string;
      subscriptionId?: string | null;
      subscriptionVersion?: number | null;
    },
    options: { clock?: () => Date } = {},
  ) {
    const tenant = new PlatformTenant(
      input.id,
      input.organizationId,
      'REGISTERED',
      'PENDING',
      input.subscriptionId ?? null,
      input.subscriptionVersion ?? null,
      null,
      0,
      1,
      true,
      [],
      options.clock ?? (() => new Date()),
    );
    tenant.event('TenantRegistered');
    return tenant;
  }
  static reconstitute(
    s: {
      id: string;
      organizationId: string;
      status: PlatformTenantStatus;
      provisioningStatus: ProvisioningStatus;
      subscriptionId: string | null;
      subscriptionVersion: number | null;
      suspendedReason: string | null;
      version: number;
      sessions: SupportSessionState[];
    },
    options: { clock?: () => Date } = {},
  ) {
    return new PlatformTenant(
      s.id,
      s.organizationId,
      s.status,
      s.provisioningStatus,
      s.subscriptionId,
      s.subscriptionVersion,
      s.suspendedReason,
      s.version,
      s.version,
      false,
      s.sessions,
      options.clock ?? (() => new Date()),
    );
  }
  get status() {
    return this._status;
  }
  get provisioningStatus() {
    return this._provisioningStatus;
  }
  get version() {
    return this._version;
  }
  get hasPendingChanges() {
    return this.isNew || this._version !== this._expectedVersion;
  }
  completeProvisioning() {
    if (!['PENDING', 'IN_PROGRESS', 'FAILED'].includes(this._provisioningStatus))
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        'Provisioning is already complete.',
      );
    this._provisioningStatus = 'COMPLETED';
    this.bump();
  }
  activate() {
    this.require(['REGISTERED']);
    if (this._provisioningStatus !== 'COMPLETED')
      throw PlatformError.of(
        ERROR_CODES.TENANT_PROVISIONING_INCOMPLETE,
        'Tenant provisioning is incomplete.',
      );
    this._status = 'ACTIVE';
    this.bump();
    this.event('TenantActivated');
  }
  suspend(reason: string) {
    this.require(['REGISTERED', 'ACTIVE']);
    if (!reason.trim()) invalid('Suspension reason is required.');
    this._status = 'SUSPENDED';
    this._suspendedReason = reason.trim();
    this.bump();
    this.event('TenantSuspended');
  }
  reactivate() {
    this.require(['SUSPENDED']);
    if (this._provisioningStatus !== 'COMPLETED')
      throw PlatformError.of(
        ERROR_CODES.TENANT_PROVISIONING_INCOMPLETE,
        'Tenant provisioning is incomplete.',
      );
    this._status = 'ACTIVE';
    this._suspendedReason = null;
    this.bump();
    this.event('TenantReactivated');
  }
  close() {
    this.require(['REGISTERED', 'ACTIVE', 'SUSPENDED']);
    this._status = 'CLOSED';
    this.bump();
    this.event('TenantClosed');
  }
  requestSupport(input: {
    id: string;
    reason: string;
    requestedByPlatformUserId: string;
    expiresAt: Date;
  }) {
    const now = this.clock();
    if (
      !input.reason.trim() ||
      !input.requestedByPlatformUserId ||
      input.expiresAt.getTime() <= now.getTime()
    )
      invalid('Support reason and future expiry are required.');
    const session: SupportSessionState = {
      ...input,
      reason: input.reason.trim(),
      status: 'REQUESTED',
      requestedAt: now,
      startedByPlatformUserId: null,
      endedByPlatformUserId: null,
      startedAt: null,
      endedAt: null,
      endReason: null,
      version: 1,
    };
    this.sessions.push(session);
    this.newSessions.push(session);
    this.bump();
    this.event('SupportAccessRequested', session);
  }
  startSupport(sessionId: string, platformUserId: string) {
    const s = this.session(sessionId);
    const now = this.clock();
    if (
      !platformUserId ||
      platformUserId !== s.requestedByPlatformUserId ||
      s.status !== 'REQUESTED' ||
      s.expiresAt.getTime() <= now.getTime()
    )
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        'Support session cannot be started.',
      );
    s.status = 'ACTIVE';
    s.startedByPlatformUserId = platformUserId;
    s.startedAt = now;
    s.version++;
    this.bump();
    this.event('SupportAccessStarted', s);
  }
  endSupport(sessionId: string, platformUserId: string, endReason?: string) {
    const s = this.session(sessionId);
    const now = this.clock();
    if (
      !platformUserId ||
      platformUserId !== s.requestedByPlatformUserId ||
      !['REQUESTED', 'ACTIVE'].includes(s.status)
    )
      throw PlatformError.of(ERROR_CODES.OPERATION_NOT_ALLOWED, 'Support session cannot be ended.');
    if (!endReason?.trim()) invalid('Support end reason is required.');
    s.status = s.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'ENDED';
    s.endedByPlatformUserId = platformUserId;
    s.endedAt = now;
    s.endReason = endReason.trim();
    s.version++;
    this.bump();
    this.event('SupportAccessEnded', s);
  }
  expireSupportSessions() {
    const now = this.clock();
    for (const s of this.sessions.filter(
      (x) => ['REQUESTED', 'ACTIVE'].includes(x.status) && x.expiresAt.getTime() <= now.getTime(),
    )) {
      s.status = 'EXPIRED';
      s.endedByPlatformUserId = SUPPORT_EXPIRY_SYSTEM_PRINCIPAL_ID;
      s.endedAt = now;
      s.endReason = 'expired';
      s.version++;
      this.bump();
      this.event('SupportAccessEnded', s);
    }
  }
  collectChanges() {
    return {
      isNew: this.isNew,
      tenantId: this.id,
      organizationId: this.organizationId,
      status: this._status,
      provisioningStatus: this._provisioningStatus,
      subscriptionId: this._subscriptionId,
      subscriptionVersion: this._subscriptionVersion,
      suspendedReason: this._suspendedReason,
      expectedVersion: this._expectedVersion,
      nextVersion: this._version,
      newSessions: this.newSessions,
      changedSessions: this.sessions.filter((s) => !this.newSessions.includes(s) && s.version > 1),
    };
  }
  pullDomainEvents() {
    return this.events.splice(0);
  }
  markPersisted() {
    this._expectedVersion = this._version;
    this.isNew = false;
    this.newSessions.splice(0);
  }
  private session(id: string) {
    const s = this.sessions.find((x) => x.id === id);
    if (!s) throw PlatformError.notFound(`Support session ${id} was not found.`);
    return s;
  }
  private require(allowed: PlatformTenantStatus[]) {
    if (!allowed.includes(this._status))
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Tenant cannot transition from ${this._status}.`,
      );
  }
  private bump() {
    this._version++;
  }
  private event(type: PlatformTenantEventType, s?: SupportSessionState) {
    this.events.push({
      type,
      occurredAt: this.clock(),
      tenantId: this.id,
      organizationId: this.organizationId,
      status: this._status,
      provisioningStatus: this._provisioningStatus,
      ...(s ? { supportSessionId: s.id, supportStatus: s.status, supportReason: s.reason } : {}),
    });
  }
}
function invalid(message: string): never {
  throw PlatformError.validationFailed(message);
}
