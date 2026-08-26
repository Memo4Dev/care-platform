import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import { Branch } from './branch';
import type {
  OrganizationDomainEvent,
  OrganizationPolicyChangedEvent,
  OrganizationStatus,
} from './events';
import {
  type PendingPolicyChange,
  type PolicyState,
  type PolicyType,
  type PolicyValue,
  assertPolicyValue,
  setPolicy as applySetPolicy,
} from './policy';
import { Warehouse } from './warehouse';

/**
 * Organization aggregate root (docs/architecture/10-organization.md).
 *
 * Aggregate boundary: the organization together with its branches and
 * warehouses. Branches/warehouses are ENTITIES mutated exclusively through
 * root commands so per-organization invariants stay in one place:
 *
 * - branch `code` is unique per organization (checked in-memory against
 *   loaded branches; the database UNIQUE constraint remains the final
 *   authority under concurrency),
 * - a warehouse is created only under a branch that belongs to the same
 *   organization (checked in-memory; backed by a composite tenant FK),
 * - lifecycle transitions are guarded: applying a command to an entity that
 *   is ALREADY in the target state is an OPERATION_NOT_ALLOWED error — there
 *   are deliberately no silent same-state no-ops for organization status.
 *   DeactivateWarehouse is the one accepted idempotent write: deactivating an
 *   already-inactive warehouse changes nothing and emits nothing.
 *
 * The file imports only plain contracts/domain modules: no NestJS, no Drizzle.
 */
export class Organization {
  private readonly branches = new Map<string, Branch>();
  private readonly warehouses = new Map<string, Warehouse>();

  private readonly policyState: PolicyState = {
    latest: new Map(),
    nextVersion: 1,
  };

  private readonly domainEvents: OrganizationDomainEvent[] = [];
  private readonly pendingNewBranches: Branch[] = [];
  private readonly pendingBranchChanges: Branch[] = [];
  private readonly pendingNewWarehouses: Warehouse[] = [];
  private readonly pendingWarehouseChanges: Warehouse[] = [];
  private readonly pendingPolicies: PendingPolicyChange[] = [];

  private constructor(
    readonly id: string,
    private _name: string,
    private _status: OrganizationStatus,
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
   * Domain command: CreateOrganization.
   *
   * New organizations start ACTIVE by default — an explicit M1 provisioning
   * simplification so tenant provisioning can complete in a single pass
   * without a separate activation step. Suspension remains fully supported;
   * revisiting the default is a product decision, not an implementation need.
   * Emits exactly one OrganizationCreated event.
   */
  static create(
    input: { id: string; name: string },
    options: OrganizationOptions = {},
  ): Organization {
    const name = assertNonEmpty(input.name, 'name');
    const aggregate = new Organization(
      input.id,
      name,
      'ACTIVE',
      0,
      1,
      true,
      options.clock ?? (() => new Date()),
    );

    aggregate.domainEvents.push({
      type: 'OrganizationCreated',
      occurredAt: aggregate.clock(),
      organizationId: aggregate.id,
      name: aggregate._name,
      status: 'ACTIVE',
    });

    return aggregate;
  }

  /**
   * Rehydrate a persisted aggregate from repository data. No events are
   * emitted during rehydration.
   */
  static reconstitute(
    state: {
      id: string;
      name: string;
      status: OrganizationStatus;
      version: number;
      branches: Array<Parameters<typeof Branch.reconstitute>[0]>;
      warehouses: Array<Parameters<typeof Warehouse.reconstitute>[0]>;
      policies: ReadonlyArray<{ policyType: PolicyType; value: PolicyValue; version: number }>;
    },
    options: OrganizationOptions = {},
  ): Organization {
    const aggregate = new Organization(
      state.id,
      state.name,
      state.status,
      state.version,
      state.version,
      false,
      options.clock ?? (() => new Date()),
    );

    for (const branch of state.branches) {
      aggregate.branches.set(branch.id, Branch.reconstitute(branch));
    }
    for (const warehouse of state.warehouses) {
      aggregate.warehouses.set(warehouse.id, Warehouse.reconstitute(warehouse));
    }

    let maxPolicyVersion = 0;
    for (const entry of state.policies) {
      if (entry.version > maxPolicyVersion) {
        maxPolicyVersion = entry.version;
      }
      const existing = aggregate.policyState.latest.get(entry.policyType);
      if (!existing || entry.version > existing.version) {
        aggregate.policyState.latest.set(entry.policyType, {
          value: entry.value,
          version: entry.version,
        });
      }
    }
    aggregate.policyState.nextVersion = maxPolicyVersion + 1;

    return aggregate;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get name(): string {
    return this._name;
  }

  get status(): OrganizationStatus {
    return this._status;
  }

  get expectedVersion(): number {
    return this._expectedVersion;
  }

  /** Version to write on the next persist. */
  get version(): number {
    return this._version;
  }

  listBranches(): readonly Branch[] {
    return [...this.branches.values()];
  }

  listWarehouses(): readonly Warehouse[] {
    return [...this.warehouses.values()];
  }

  findBranch(branchId: string): Branch | undefined {
    return this.branches.get(branchId);
  }

  findWarehouse(warehouseId: string): Warehouse | undefined {
    return this.warehouses.get(warehouseId);
  }

  /** Latest known value+version of a policy type, or undefined when unset. */
  latestPolicy(
    policyType: PolicyType,
  ): { readonly value: PolicyValue; readonly version: number } | undefined {
    return this.policyState.latest.get(policyType);
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: ActivateOrganization (SUSPENDED -> ACTIVE).
   * Activating an already-active organization is an invalid transition.
   */
  activate(): void {
    if (this._status === 'ACTIVE') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Organization ${this.id} is already active.`,
        { details: { organizationId: this.id, status: this._status } },
      );
    }
    this._status = 'ACTIVE';
    this.bumpVersion();
    this.domainEvents.push({
      type: 'OrganizationActivated',
      occurredAt: this.clock(),
      organizationId: this.id,
    });
  }

  /**
   * Domain command: SuspendOrganization (ACTIVE -> SUSPENDED).
   * Suspending an already-suspended organization is an invalid transition —
   * NOT a silent no-op success (explicit task/architecture decision).
   */
  suspend(): void {
    if (this._status === 'SUSPENDED') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Organization ${this.id} is already suspended.`,
        { details: { organizationId: this.id, status: this._status } },
      );
    }
    this._status = 'SUSPENDED';
    this.bumpVersion();
    this.domainEvents.push({
      type: 'OrganizationSuspended',
      occurredAt: this.clock(),
      organizationId: this.id,
    });
  }

  /**
   * Domain command: CreateBranch. Enforces per-organization branch-code
   * uniqueness against loaded state (DB constraint is the concurrent-case
   * backstop). Emits BranchCreated.
   */
  createBranch(input: { id: string; code: string; name: string; priority?: number }): void {
    const code = assertNonEmpty(input.code, 'code');
    const name = assertNonEmpty(input.name, 'name');
    const priority = input.priority ?? 0;

    if (!Number.isInteger(priority)) {
      throw PlatformError.validationFailed('Branch priority must be an integer.', {
        details: { field: 'priority', branchId: input.id },
      });
    }

    if ([...this.branches.values()].some((branch) => branch.code === code)) {
      throw PlatformError.validationFailed(
        `Branch code "${code}" already exists in organization ${this.id}.`,
        { details: { field: 'code', code, organizationId: this.id } },
      );
    }

    const branch = Branch.create({
      id: input.id,
      organizationId: this.id,
      code,
      name,
      priority,
    });
    this.branches.set(branch.id, branch);
    this.pendingNewBranches.push(branch);
    this.bumpVersion();

    this.domainEvents.push({
      type: 'BranchCreated',
      occurredAt: this.clock(),
      organizationId: this.id,
      branchId: branch.id,
      code: branch.code,
      name: branch.name,
      priority: branch.priority,
    });
  }

  /**
   * Domain command: ChangeBranchPriority. Emits BranchPriorityChanged even
   * when the value is unchanged: the recorded fact is "priority was set",
   * which keeps replay deterministic.
   */
  changeBranchPriority(input: { branchId: string; priority: number }): void {
    const branch = this.requireBranch(input.branchId);
    branch.changePriority(input.priority);
    if (!this.pendingBranchChanges.includes(branch)) {
      this.pendingBranchChanges.push(branch);
    }
    this.bumpVersion();

    this.domainEvents.push({
      type: 'BranchPriorityChanged',
      occurredAt: this.clock(),
      organizationId: this.id,
      branchId: branch.id,
      priority: branch.priority,
    });
  }

  /**
   * Domain command: CreateWarehouse. The warehouse must hang off a branch of
   * THIS organization — cross-organization references cannot be expressed
   * because only own-aggregate branches are addressable here. Emits
   * WarehouseCreated.
   */
  createWarehouse(input: { id: string; branchId: string; code: string; name: string }): void {
    const code = assertNonEmpty(input.code, 'code');
    const name = assertNonEmpty(input.name, 'name');
    const branch = this.requireBranch(input.branchId);

    const duplicateWithinBranch = [...this.warehouses.values()].some(
      (warehouse) => warehouse.branchId === branch.id && warehouse.code === code,
    );
    if (duplicateWithinBranch) {
      throw PlatformError.validationFailed(
        `Warehouse code "${code}" already exists in branch ${branch.id}.`,
        {
          details: {
            field: 'code',
            code,
            organizationId: this.id,
            branchId: branch.id,
          },
        },
      );
    }

    const warehouse = Warehouse.create({
      id: input.id,
      organizationId: this.id,
      branchId: branch.id,
      code,
      name,
    });
    this.warehouses.set(warehouse.id, warehouse);
    this.pendingNewWarehouses.push(warehouse);
    this.bumpVersion();

    this.domainEvents.push({
      type: 'WarehouseCreated',
      occurredAt: this.clock(),
      organizationId: this.id,
      warehouseId: warehouse.id,
      branchId: warehouse.branchId,
      code: warehouse.code,
      name: warehouse.name,
    });
  }

  /**
   * Domain command: DeactivateWarehouse. Allowed even for the last ACTIVE
   * warehouse of its branch (no rule forbids it; none invented). Emits
   * WarehouseDeactivated exactly when a state change happened.
   */
  deactivateWarehouse(input: { warehouseId: string }): void {
    const warehouse = this.requireWarehouse(input.warehouseId);

    const deactivated = warehouse.deactivate();
    if (!deactivated) {
      return;
    }
    if (!this.pendingWarehouseChanges.includes(warehouse)) {
      this.pendingWarehouseChanges.push(warehouse);
    }
    this.bumpVersion();

    this.domainEvents.push({
      type: 'WarehouseDeactivated',
      occurredAt: this.clock(),
      organizationId: this.id,
      warehouseId: warehouse.id,
      branchId: warehouse.branchId,
    });
  }

  /**
   * Domain command: SetPolicy(policyType, value) — the unified form of the
   * eight SetXPolicy commands. Appends one immutable history entry with the
   * next per-organization monotonic policy version and emits
   * OrganizationPolicyChanged.
   */
  setPolicy(input: { policyType: PolicyType; value: PolicyValue }): void {
    assertPolicyValue(input.value);

    const change = applySetPolicy(this.policyState, this.id, input.policyType, input.value);
    this.pendingPolicies.push(change);
    this.bumpVersion();

    const event: OrganizationPolicyChangedEvent = {
      type: 'OrganizationPolicyChanged',
      occurredAt: this.clock(),
      organizationId: this.id,
      policyType: change.policyType,
      value: change.value,
      policyVersion: change.version,
    };
    this.domainEvents.push(event);
  }

  // ---------------------------------------------------------------------------
  // Persistence collaboration
  // ---------------------------------------------------------------------------

  /** True while at least one change (including creation) awaits persistence. */
  get hasPendingChanges(): boolean {
    return (
      this.pendingInsert ||
      this._version !== this._expectedVersion ||
      this.pendingNewBranches.length > 0 ||
      this.pendingBranchChanges.length > 0 ||
      this.pendingNewWarehouses.length > 0 ||
      this.pendingWarehouseChanges.length > 0 ||
      this.pendingPolicies.length > 0
    );
  }

  /**
   * Snapshot of everything the repository must write. Read-only: journals are
   * consumed later by {@link markPersisted} after a successful save.
   */
  collectChanges(): OrganizationChangeSet {
    return {
      isNew: this.pendingInsert,
      organizationId: this.id,
      name: this._name,
      status: this._status,
      expectedVersion: this._expectedVersion,
      nextVersion: this._version,
      newBranches: this.pendingNewBranches.map(toBranchRecord),
      changedBranches: this.pendingBranchChanges.map(toBranchRecord),
      newWarehouses: this.pendingNewWarehouses.map(toWarehouseRecord),
      changedWarehouses: this.pendingWarehouseChanges.map(toWarehouseRecord),
      newPolicies: [...this.pendingPolicies],
    };
  }

  /** All events collected since the last pull, in emission order. */
  pullDomainEvents(): OrganizationDomainEvent[] {
    return this.domainEvents.splice(0, this.domainEvents.length);
  }

  /**
   * Called by the repository after a successful transactional save: commits
   * local versions as persisted versions and clears change journals.
   */
  markPersisted(): void {
    for (const branch of this.pendingNewBranches) {
      branch.markPersisted();
    }
    for (const branch of this.pendingBranchChanges) {
      branch.markPersisted();
    }
    for (const warehouse of this.pendingNewWarehouses) {
      warehouse.markPersisted();
    }
    for (const warehouse of this.pendingWarehouseChanges) {
      warehouse.markPersisted();
    }
    this.pendingNewBranches.length = 0;
    this.pendingBranchChanges.length = 0;
    this.pendingNewWarehouses.length = 0;
    this.pendingWarehouseChanges.length = 0;
    this.pendingPolicies.length = 0;

    this._expectedVersion = this._version;
    // After the first successful save the insert becomes an update.
    this.pendingInsert = false;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private requireBranch(branchId: string): Branch {
    const branch = this.branches.get(branchId);
    if (!branch) {
      throw PlatformError.notFound(
        `Branch ${branchId} does not belong to organization ${this.id}.`,
        { details: { branchId, organizationId: this.id } },
      );
    }
    return branch;
  }

  private requireWarehouse(warehouseId: string): Warehouse {
    const warehouse = this.warehouses.get(warehouseId);
    if (!warehouse) {
      throw PlatformError.notFound(
        `Warehouse ${warehouseId} does not belong to organization ${this.id}.`,
        { details: { warehouseId, organizationId: this.id } },
      );
    }
    return warehouse;
  }

  private bumpVersion(): void {
    this._version += 1;
  }
}

export interface OrganizationOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}

/** One persisted branch record inside a change set. */
export interface PersistedBranchChange {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  priority: number;
  isActive: boolean;
  /** Version to write. */
  version: number;
  /** Version currently persisted (CAS guard; 0 for inserts). */
  expectedVersion: number;
}

/** One persisted warehouse record inside a change set. */
export interface PersistedWarehouseChange {
  id: string;
  organizationId: string;
  branchId: string;
  code: string;
  name: string;
  isActive: boolean;
  version: number;
  expectedVersion: number;
}

/** Everything the repository writes for one aggregate save. */
export interface OrganizationChangeSet {
  isNew: boolean;
  organizationId: string;
  name: string;
  status: OrganizationStatus;
  /** Version currently persisted (CAS guard; ignored when isNew). */
  expectedVersion: number;
  /** Version to write. */
  nextVersion: number;
  newBranches: PersistedBranchChange[];
  changedBranches: PersistedBranchChange[];
  newWarehouses: PersistedWarehouseChange[];
  changedWarehouses: PersistedWarehouseChange[];
  newPolicies: PendingPolicyChange[];
}

function toBranchRecord(branch: Branch): PersistedBranchChange {
  return {
    id: branch.id,
    organizationId: branch.organizationId,
    code: branch.code,
    name: branch.name,
    priority: branch.priority,
    isActive: branch.isActive,
    version: branch.version,
    expectedVersion: branch.expectedVersion,
  };
}

function toWarehouseRecord(warehouse: Warehouse): PersistedWarehouseChange {
  return {
    id: warehouse.id,
    organizationId: warehouse.organizationId,
    branchId: warehouse.branchId,
    code: warehouse.code,
    name: warehouse.name,
    isActive: warehouse.isActive,
    version: warehouse.version,
    expectedVersion: warehouse.expectedVersion,
  };
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw PlatformError.validationFailed(`${field} must be a non-empty string.`, {
      details: { field },
    });
  }
  return value;
}
