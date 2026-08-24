import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type { IdentityUserDomainEvent, UserCreatedEvent } from './events';

/**
 * User aggregate root (docs/architecture/11-identity-access.md).
 *
 * Aggregate boundary: the user together with its branch-scoped role
 * memberships (`user_branch_roles`) and explicit branch-access rows
 * (`branch_access`). Both child sets are ENTITIES of this aggregate and are
 * mutated exclusively through root commands so per-user invariants stay in
 * one place:
 *
 * - the owning organization is FIXED at creation (no re-tenanting command),
 * - a (user, branch, role) membership is unique; duplicate AssignRole is an
 *   OPERATION_NOT_ALLOWED error, not a silent no-op (same convention as the
 *   Organization context's guarded lifecycle transitions),
 * - holding any role on a branch IMPLIES access to that branch: AssignRole
 *   auto-grants the missing access row, while RevokeBranchAccess refuses to
 *   run while memberships remain at that branch — roles can never be stranded
 *   without access. Revoking a role never removes access: view-only grants
 *   and role-derived access are deliberately kept apart and access is always
 *   removed EXPLICITLY,
 * - suspended users keep all data; denial happens in authorization (resource-
 *   state layer), never by deleting anything.
 *
 * Supabase Auth proves identity; this context owns authorization. The
 * `supabaseUserId` mapping field links the two — no Supabase network calls
 * exist anywhere in this context.
 *
 * The file imports only plain contracts/domain modules: no NestJS, no Drizzle.
 */
export class User {
  /** Key: `${branchId}::${roleId}` — one membership per (branch, role). */
  private readonly memberships = new Map<string, UserMembership>();

  /** Explicit branch-access set (role-derived access is mirrored here). */
  private readonly branchAccess = new Set<string>();

  private readonly domainEvents: IdentityUserDomainEvent[] = [];
  private readonly pendingNewMemberships: UserMembership[] = [];
  private readonly pendingRemovedMemberships = new Map<string, UserMembership>();
  private readonly pendingGrantedBranchIds = new Set<string>();
  private readonly pendingRevokedBranchIds = new Set<string>();

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _email: string,
    private _name: string,
    private _supabaseUserId: string | null,
    private _status: UserStatus,
    /** Version currently persisted in the database (CAS guard value). */
    private _expectedVersion: number,
    /** Version to write on the next persist (persisted + local changes). */
    private _version: number,
    private pendingInsert: boolean,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreateUser. Emails are normalized to lowercase because the
   * global UNIQUE(email) constraint is case-sensitive at the storage level;
   * normalization here makes uniqueness effectively case-insensitive for every
   * application write. Emits exactly one UserCreated event.
   */
  static create(
    input: { id: string; organizationId: string; email: string; name: string },
    options: UserOptions = {},
  ): User {
    const email = normalizeEmail(input.email);
    const name = assertNonEmpty(input.name, 'name');

    const aggregate = new User(
      input.id,
      input.organizationId,
      email,
      name,
      null,
      'ACTIVE',
      0,
      1,
      true,
      options.clock ?? (() => new Date()),
    );

    const event: UserCreatedEvent = {
      type: 'UserCreated',
      occurredAt: aggregate.clock(),
      organizationId: aggregate.organizationId,
      userId: aggregate.id,
      email,
      name,
      status: 'ACTIVE',
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
      email: string;
      name: string;
      supabaseUserId: string | null;
      status: UserStatus;
      version: number;
      memberships: ReadonlyArray<UserMembership>;
      branchAccess: readonly string[];
    },
    options: UserOptions = {},
  ): User {
    const aggregate = new User(
      state.id,
      state.organizationId,
      state.email,
      state.name,
      state.supabaseUserId,
      state.status,
      state.version,
      state.version,
      false,
      options.clock ?? (() => new Date()),
    );

    for (const membership of state.memberships) {
      aggregate.memberships.set(membershipKey(membership), { ...membership });
    }
    for (const branchId of state.branchAccess) {
      aggregate.branchAccess.add(branchId);
    }

    return aggregate;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get email(): string {
    return this._email;
  }

  get name(): string {
    return this._name;
  }

  get supabaseUserId(): string | null {
    return this._supabaseUserId;
  }

  get status(): UserStatus {
    return this._status;
  }

  get expectedVersion(): number {
    return this._expectedVersion;
  }

  /** Version to write on the next persist. */
  get version(): number {
    return this._version;
  }

  listMemberships(): readonly UserMembership[] {
    return [...this.memberships.values()];
  }

  listBranchAccess(): readonly string[] {
    return [...this.branchAccess];
  }

  hasMembership(branchId: string, roleId: string): boolean {
    return this.memberships.has(membershipKey({ branchId, roleId }));
  }

  hasBranchAccess(branchId: string): boolean {
    return this.branchAccess.has(branchId);
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: LinkIdentity. Links the platform user to its Supabase
   * Auth identity exactly once — linking an already-linked user is rejected
   * even when the value matches, because identity remapping is a support
   * workflow that must stay explicit (there is deliberately no relink command
   * in v1). State-only change: no outbox event per the minimal event set.
   */
  linkIdentity(supabaseUserId: string): void {
    const value = assertNonEmpty(supabaseUserId, 'supabaseUserId');
    if (this._supabaseUserId !== null) {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `User ${this.id} is already linked to a Supabase identity.`,
        {
          details: {
            userId: this.id,
            organizationId: this.organizationId,
            status: this._status,
          },
        },
      );
    }
    this._supabaseUserId = value;
    this.bumpVersion();
    this.domainEvents.push({
      type: 'UserIdentityLinked',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      userId: this.id,
    });
  }

  /**
   * Domain command: SuspendUser (ACTIVE -> SUSPENDED). Authorization denies
   * suspended users (resource-state layer); data is retained. Suspending an
   * already-suspended user is an invalid transition — NOT a silent no-op.
   */
  suspend(): void {
    if (this._status === 'SUSPENDED') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `User ${this.id} is already suspended.`,
        { details: { userId: this.id, organizationId: this.organizationId } },
      );
    }
    this._status = 'SUSPENDED';
    this.bumpVersion();
    this.domainEvents.push({
      type: 'UserSuspended',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      userId: this.id,
    });
  }

  /** Domain command: ReactivateUser (SUSPENDED -> ACTIVE). */
  reactivate(): void {
    if (this._status === 'ACTIVE') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `User ${this.id} is already active.`,
        { details: { userId: this.id, organizationId: this.organizationId } },
      );
    }
    this._status = 'ACTIVE';
    this.bumpVersion();
    this.domainEvents.push({
      type: 'UserReactivated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      userId: this.id,
    });
  }

  /**
   * Domain command: AssignRole(userId -> role AT branch). The application
   * service validates beforehand that the role and the branch belong to this
   * user's organization (the aggregate cannot see other aggregates); the
   * composite tenant FKs remain the concurrent-case backstop.
   *
   * Emits UserRoleAssigned plus BranchAccessGranted exactly when the assignment
   * creates the user's first presence on that branch.
   */
  assignRole(input: { roleId: string; branchId: string }): void {
    assertNonEmpty(input.roleId, 'roleId');
    assertNonEmpty(input.branchId, 'branchId');
    const key = membershipKey(input);

    if (this.memberships.has(key)) {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `User ${this.id} already holds role ${input.roleId} at branch ${input.branchId}.`,
        {
          details: {
            userId: this.id,
            organizationId: this.organizationId,
            roleId: input.roleId,
            branchId: input.branchId,
          },
        },
      );
    }

    const membership: UserMembership = { ...input };
    this.memberships.set(key, membership);
    this.pendingNewMemberships.push(membership);
    this.pendingRemovedMemberships.delete(key);

    // The command fact is emitted FIRST; the derived access side effect follows
    // so event consumers read "role assigned" before "access granted".
    this.bumpVersion();
    this.domainEvents.push({
      type: 'UserRoleAssigned',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      userId: this.id,
      roleId: input.roleId,
      branchId: input.branchId,
    });

    if (!this.branchAccess.has(input.branchId)) {
      // DECISION: holding any role on a branch implies branch access. Emit
      // BranchAccessGranted exactly when the assignment creates the user's
      // first presence on that branch.
      this.recordBranchAccessGrant(input.branchId);
      this.domainEvents.push({
        type: 'BranchAccessGranted',
        occurredAt: this.clock(),
        organizationId: this.organizationId,
        userId: this.id,
        branchId: input.branchId,
      });
    }
  }

  /**
   * Domain command: RevokeRole. Removing the last role of a branch does NOT
   * remove branch access — explicit access survives (view-only staff keep
   * their grant). Revoking a non-held membership is an error, not a no-op.
   */
  revokeRole(input: { roleId: string; branchId: string }): void {
    const key = membershipKey(input);
    if (!this.memberships.has(key)) {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `User ${this.id} does not hold role ${input.roleId} at branch ${input.branchId}.`,
        {
          details: {
            userId: this.id,
            organizationId: this.organizationId,
            roleId: input.roleId,
            branchId: input.branchId,
          },
        },
      );
    }

    this.memberships.delete(key);
    if (this.pendingNewMemberships.some((membership) => membershipKey(membership) === key)) {
      // Insert not yet persisted: drop it from the insert journal instead of
      // writing an insert+delete pair inside one transaction.
      const index = this.pendingNewMemberships.findIndex(
        (membership) => membershipKey(membership) === key,
      );
      this.pendingNewMemberships.splice(index, 1);
      this.pendingRemovedMemberships.delete(key);
    } else {
      this.pendingRemovedMemberships.set(key, { ...input });
    }

    this.bumpVersion();
    this.domainEvents.push({
      type: 'UserRoleRevoked',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      userId: this.id,
      roleId: input.roleId,
      branchId: input.branchId,
    });
  }

  /** Domain command: GrantBranchAccess — explicit access WITHOUT any role
   * (e.g. view-only staff). Duplicate grants are errors, not no-ops.
   */
  grantBranchAccess(branchId: string): void {
    assertNonEmpty(branchId, 'branchId');
    if (this.branchAccess.has(branchId)) {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `User ${this.id} already has access to branch ${branchId}.`,
        {
          details: {
            userId: this.id,
            organizationId: this.organizationId,
            branchId,
          },
        },
      );
    }
    this.recordBranchAccessGrant(branchId);
    this.bumpVersion();
    this.domainEvents.push({
      type: 'BranchAccessGranted',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      userId: this.id,
      branchId,
    });
  }

  /**
   * Domain command: RevokeBranchAccess. Refuses while role memberships remain
   * at the branch (revoke roles first): "any role implies access" must hold
   * after every accepted command. Revoking absent access is an error.
   */
  revokeBranchAccess(branchId: string): void {
    if (!this.branchAccess.has(branchId)) {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `User ${this.id} has no access to branch ${branchId}.`,
        {
          details: {
            userId: this.id,
            organizationId: this.organizationId,
            branchId,
          },
        },
      );
    }
    const remainingRoles = this.listMemberships()
      .filter((membership) => membership.branchId === branchId)
      .map((membership) => membership.roleId);
    if (remainingRoles.length > 0) {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `User ${this.id} still holds roles at branch ${branchId}; revoke them before removing access.`,
        {
          details: {
            userId: this.id,
            organizationId: this.organizationId,
            branchId,
            remainingRoleIds: remainingRoles,
          },
        },
      );
    }

    this.branchAccess.delete(branchId);
    this.pendingGrantedBranchIds.delete(branchId);
    this.pendingRevokedBranchIds.add(branchId);

    this.bumpVersion();
    this.domainEvents.push({
      type: 'BranchAccessRevoked',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      userId: this.id,
      branchId,
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
      this.pendingNewMemberships.length > 0 ||
      this.pendingRemovedMemberships.size > 0 ||
      this.pendingGrantedBranchIds.size > 0 ||
      this.pendingRevokedBranchIds.size > 0
    );
  }

  /**
   * Snapshot of everything the repository must write. Read-only: journals are
   * consumed later by {@link markPersisted} after a successful save.
   */
  collectChanges(): UserChangeSet {
    return {
      isNew: this.pendingInsert,
      userId: this.id,
      organizationId: this.organizationId,
      email: this._email,
      name: this._name,
      supabaseUserId: this._supabaseUserId,
      status: this._status,
      expectedVersion: this._expectedVersion,
      nextVersion: this._version,
      newMemberships: this.pendingNewMemberships.map((membership) => ({ ...membership })),
      removedMemberships: [...this.pendingRemovedMemberships.values()].map((membership) => ({
        ...membership,
      })),
      grantedBranchIds: [...this.pendingGrantedBranchIds],
      revokedBranchIds: [...this.pendingRevokedBranchIds],
    };
  }

  /** All events collected since the last pull, in emission order. */
  pullDomainEvents(): IdentityUserDomainEvent[] {
    return this.domainEvents.splice(0, this.domainEvents.length);
  }

  /**
   * Called by the repository after a successful transactional save: commits
   * local versions as persisted versions and clears change journals.
   */
  markPersisted(): void {
    this.pendingNewMemberships.length = 0;
    this.pendingRemovedMemberships.clear();
    this.pendingGrantedBranchIds.clear();
    this.pendingRevokedBranchIds.clear();

    this._expectedVersion = this._version;
    this.pendingInsert = false;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Records the access side effect shared by AssignRole/GrantBranchAccess.
   * Callers guarantee the branch is not yet present in the access set.
   */
  private recordBranchAccessGrant(branchId: string): void {
    this.branchAccess.add(branchId);
    this.pendingGrantedBranchIds.add(branchId);
    this.pendingRevokedBranchIds.delete(branchId);
  }

  private bumpVersion(): void {
    this._version += 1;
  }
}

export interface UserOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}

/** Lifecycle status of a user aggregate (mirrors the DB enum). */
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

/** One branch-scoped role grant owned by the User aggregate. */
export interface UserMembership {
  readonly branchId: string;
  readonly roleId: string;
}

function membershipKey(membership: { branchId: string; roleId: string }): string {
  return `${membership.branchId}::${membership.roleId}`;
}

/** Everything the repository writes for one aggregate save. */
export interface UserChangeSet {
  isNew: boolean;
  userId: string;
  organizationId: string;
  email: string;
  name: string;
  supabaseUserId: string | null;
  status: UserStatus;
  /** Version currently persisted (CAS guard; ignored when isNew). */
  expectedVersion: number;
  /** Version to write. */
  nextVersion: number;
  newMemberships: UserMembership[];
  removedMemberships: UserMembership[];
  grantedBranchIds: string[];
  revokedBranchIds: string[];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalizes and syntax-checks an email address. Deliberately minimal:
 * Supabase Auth owns deliverability/verification; this guard only stops
 * obviously malformed values and enforces the lowercase storage convention.
 */
export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw PlatformError.validationFailed('email must be a non-empty string.', {
      details: { field: 'email' },
    });
  }
  const normalized = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw PlatformError.validationFailed('email must be a valid email address.', {
      details: { field: 'email' },
    });
  }
  return normalized;
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw PlatformError.validationFailed(`${field} must be a non-empty string.`, {
      details: { field },
    });
  }
  return value;
}
