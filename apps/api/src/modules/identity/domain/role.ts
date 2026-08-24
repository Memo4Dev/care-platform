import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import type { PermissionCode } from '@commerce-platform/database';

import type { IdentityRoleDomainEvent, RoleCreatedEvent } from './events';

/**
 * Role aggregate root (docs/architecture/11-identity-access.md).
 *
 * A role belongs to exactly one organization and carries a replace-set of
 * permission codes (`role_permissions`). Commands: CreateRole, RenameRole,
 * SetRolePermissions.
 *
 * DECISION — system templates stay editable: `is_system` marks rows seeded
 * from the authorization matrix templates (Owner/Manager/...) but does NOT
 * freeze their permission sets. The matrix marks most capability cells
 * "configurable", meaning the template ships WITHOUT the permission and the
 * Owner grants it later via users.manage; freezing template permissions would
 * make "configurable" impossible. There is deliberately no delete command in
 * v1, which trivially satisfies "system templates cannot be deleted".
 *
 * SetRolePermissions always emits RolePermissionsChanged carrying the FULL new
 * set — even when the set is unchanged — because the recorded fact is
 * "permissions were set" (same replay-determinism rationale as the
 * Organization context's BranchPriorityChanged).
 *
 * The file imports only plain contracts/domain modules: no NestJS, no Drizzle.
 */
export class Role {
  /** Current granted permission codes; insertion order, deduplicated. */
  private readonly _permissionCodes: PermissionCode[];

  private readonly domainEvents: IdentityRoleDomainEvent[] = [];
  private readonly pendingNewPermissionCodes: PermissionCode[] = [];
  private readonly pendingRemovedPermissionCodes: PermissionCode[] = [];

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _code: string,
    private _name: string,
    private readonly _isSystem: boolean,
    permissionCodes: readonly PermissionCode[],
    /** Version currently persisted in the database (CAS guard value). */
    private _expectedVersion: number,
    /** Version to write on the next persist (persisted + local changes). */
    private _version: number,
    private pendingInsert: boolean,
    private readonly clock: () => Date,
  ) {
    this._permissionCodes = [...new Set(permissionCodes)];
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreateRole. New roles start with an EMPTY permission set;
   * use SetRolePermissions to grant capabilities (the two-step flow keeps
   * CreateRole free of catalog validation and emits one auditable
   * RolePermissionsChanged per grant round). Emits exactly one RoleCreated
   * event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      code: string;
      name: string;
      isSystem?: boolean;
    },
    options: RoleOptions = {},
  ): Role {
    const code = assertNonEmpty(input.code, 'code');
    const name = assertNonEmpty(input.name, 'name');

    const aggregate = new Role(
      input.id,
      input.organizationId,
      code,
      name,
      input.isSystem ?? false,
      [],
      0,
      1,
      true,
      options.clock ?? (() => new Date()),
    );

    const event: RoleCreatedEvent = {
      type: 'RoleCreated',
      occurredAt: aggregate.clock(),
      organizationId: aggregate.organizationId,
      roleId: aggregate.id,
      code,
      name,
      isSystem: aggregate._isSystem,
    };
    aggregate.domainEvents.push(event);

    return aggregate;
  }

  /**
   * Rehydrate a persisted aggregate from repository data. No events are
   * emitted during rehydration.
   */
  static reconstitute(
    state: {
      id: string;
      organizationId: string;
      code: string;
      name: string;
      isSystem: boolean;
      version: number;
      permissionCodes: readonly PermissionCode[];
    },
    options: RoleOptions = {},
  ): Role {
    return new Role(
      state.id,
      state.organizationId,
      state.code,
      state.name,
      state.isSystem,
      state.permissionCodes,
      state.version,
      state.version,
      false,
      options.clock ?? (() => new Date()),
    );
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get code(): string {
    return this._code;
  }

  get name(): string {
    return this._name;
  }

  get isSystem(): boolean {
    return this._isSystem;
  }

  get expectedVersion(): number {
    return this._expectedVersion;
  }

  /** Version to write on the next persist. */
  get version(): number {
    return this._version;
  }

  listPermissionCodes(): readonly PermissionCode[] {
    return [...this._permissionCodes];
  }

  hasPermissionCode(code: PermissionCode): boolean {
    return this._permissionCodes.includes(code);
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: RenameRole. State-only change: no outbox event per the
   * minimal event set (RoleCreated already carried the original name; add a
   * RoleRenamed variant when a consumer actually needs renames).
   */
  rename(name: string): void {
    const value = assertNonEmpty(name, 'name');
    if (value === this._name) {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Role ${this.id} is already named "${value}".`,
        { details: { roleId: this.id, organizationId: this.organizationId } },
      );
    }
    this._name = value;
    this.bumpVersion();
    this.domainEvents.push({
      type: 'RoleRenamed',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      roleId: this.id,
    });
  }

  /**
   * Domain command: SetRolePermissions — REPLACE-set semantics: the given list
   * becomes the complete granted set (missing codes are revoked, extra codes
   * are added). Duplicates in the input collapse. The application service
   * validates every code against the global catalog BEFORE calling this.
   */
  setPermissions(permissionCodes: readonly PermissionCode[]): void {
    for (const code of permissionCodes) {
      if (typeof code !== 'string' || code.trim().length === 0) {
        throw PlatformError.validationFailed('permission codes must be non-empty strings.', {
          details: { field: 'permissionCodes' },
        });
      }
    }

    const next = [...new Set(permissionCodes)];
    const removed = this._permissionCodes.filter((code) => !next.includes(code));
    const added = next.filter((code) => !this._permissionCodes.includes(code));

    this._permissionCodes.length = 0;
    this._permissionCodes.push(...next);

    this.pendingNewPermissionCodes.push(...added);
    this.pendingRemovedPermissionCodes.push(...removed);
    this.bumpVersion();

    this.domainEvents.push({
      type: 'RolePermissionsChanged',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      roleId: this.id,
      permissionCodes: [...next],
    });
  }

  // ---------------------------------------------------------------------------
  // Persistence collaboration
  // ---------------------------------------------------------------------------

  /** True while at least one change (including creation) awaits persistence. */
  get hasPendingChanges(): boolean {
    return (
      this.pendingInsert ||
      this._version !== this._expectedVersion ||
      this.pendingNewPermissionCodes.length > 0 ||
      this.pendingRemovedPermissionCodes.length > 0
    );
  }

  /**
   * Snapshot of everything the repository must write. Read-only: journals are
   * consumed later by {@link markPersisted} after a successful save.
   */
  collectChanges(): RoleChangeSet {
    return {
      isNew: this.pendingInsert,
      roleId: this.id,
      organizationId: this.organizationId,
      code: this._code,
      name: this._name,
      isSystem: this._isSystem,
      permissionCodes: [...this._permissionCodes],
      expectedVersion: this._expectedVersion,
      nextVersion: this._version,
      newPermissionCodes: [...this.pendingNewPermissionCodes],
      removedPermissionCodes: [...this.pendingRemovedPermissionCodes],
    };
  }

  /** All events collected since the last pull, in emission order. */
  pullDomainEvents(): IdentityRoleDomainEvent[] {
    return this.domainEvents.splice(0, this.domainEvents.length);
  }

  /**
   * Called by the repository after a successful transactional save: commits
   * local versions as persisted versions and clears change journals.
   */
  markPersisted(): void {
    this.pendingNewPermissionCodes.length = 0;
    this.pendingRemovedPermissionCodes.length = 0;

    this._expectedVersion = this._version;
    this.pendingInsert = false;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private bumpVersion(): void {
    this._version += 1;
  }
}

export interface RoleOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}

/** Everything the repository writes for one aggregate save. */
export interface RoleChangeSet {
  isNew: boolean;
  roleId: string;
  organizationId: string;
  code: string;
  name: string;
  isSystem: boolean;
  /** Full current granted set (post-command). */
  permissionCodes: PermissionCode[];
  /** Version currently persisted (CAS guard; ignored when isNew). */
  expectedVersion: number;
  /** Version to write. */
  nextVersion: number;
  newPermissionCodes: PermissionCode[];
  removedPermissionCodes: PermissionCode[];
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw PlatformError.validationFailed(`${field} must be a non-empty string.`, {
      details: { field },
    });
  }
  return value;
}
