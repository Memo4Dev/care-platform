import { PlatformError } from '@commerce-platform/contracts';

/**
 * Branch entity — owned by the Organization aggregate.
 *
 * Branches are NOT independent aggregate roots: every mutation goes through
 * Organization aggregate commands so that per-organization invariants
 * (unique branch codes, tenant scope) are enforced in one place. The database
 * remains the final authority for code uniqueness via
 * UNIQUE (organization_id, code).
 *
 * `expectedVersion` is the version currently persisted; `version` is the next
 * value to write. The two are equal for clean entities and diverge only while
 * changes await persistence.
 */
export interface BranchState {
  readonly id: string;
  readonly organizationId: string;
  code: string;
  name: string;
  priority: number;
  isActive: boolean;
}

export class Branch {
  private constructor(
    private readonly state: BranchState,
    /** Version currently persisted in the database. */
    private _expectedVersion: number,
    /** Version to write on the next persist (persisted + local changes). */
    private _version: number,
  ) {}

  static create(input: {
    id: string;
    organizationId: string;
    code: string;
    name: string;
    priority: number;
  }): Branch {
    return new Branch(
      {
        id: input.id,
        organizationId: input.organizationId,
        code: input.code,
        name: input.name,
        priority: input.priority,
        isActive: true,
      },
      0,
      1,
    );
  }

  /** Rehydrate an already-persisted branch from repository data. */
  static reconstitute(state: BranchState & { version: number }): Branch {
    return new Branch({ ...state }, state.version, state.version);
  }

  get id(): string {
    return this.state.id;
  }

  get organizationId(): string {
    return this.state.organizationId;
  }

  get code(): string {
    return this.state.code;
  }

  get name(): string {
    return this.state.name;
  }

  get priority(): number {
    return this.state.priority;
  }

  get isActive(): boolean {
    return this.state.isActive;
  }

  /** Version currently persisted in the database (CAS guard value). */
  get expectedVersion(): number {
    return this._expectedVersion;
  }

  /** Version to write on the next persist. */
  get version(): number {
    return this._version;
  }

  /** True while local changes have not been persisted yet. */
  get hasPendingChanges(): boolean {
    return this._version !== this._expectedVersion;
  }

  /**
   * Domain command: ChangeBranchPriority. Organization controls branch
   * fulfillment priority (docs/architecture/10-organization.md).
   */
  changePriority(priority: number): void {
    if (!Number.isInteger(priority)) {
      throw PlatformError.validationFailed('Branch priority must be an integer.', {
        details: { field: 'priority', branchId: this.state.id },
      });
    }
    this.state.priority = priority;
    this._version += 1;
  }

  /** Commit the pending version after a successful persist. */
  markPersisted(): void {
    this._expectedVersion = this._version;
  }
}
