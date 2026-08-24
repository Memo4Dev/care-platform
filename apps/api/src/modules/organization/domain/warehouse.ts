/**
 * Warehouse entity — owned by the Organization aggregate.
 *
 * A warehouse always belongs to a branch of the same organization; the
 * membership invariant is checked by the aggregate (which holds all branches)
 * and additionally enforced at the database level through the composite
 * tenant FK warehouses(branch_id, organization_id) -> branches(id,
 * organization_id) — Layer 3 of docs/architecture/71-multi-tenant-isolation.md.
 *
 * Version semantics mirror Branch: `expectedVersion` is persisted state,
 * `version` is the next value to write.
 */
export interface WarehouseState {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  code: string;
  name: string;
  isActive: boolean;
}

export class Warehouse {
  private constructor(
    private readonly state: WarehouseState,
    /** Version currently persisted in the database. */
    private _expectedVersion: number,
    /** Version to write on the next persist (persisted + local changes). */
    private _version: number,
  ) {}

  static create(input: {
    id: string;
    organizationId: string;
    branchId: string;
    code: string;
    name: string;
  }): Warehouse {
    return new Warehouse(
      {
        id: input.id,
        organizationId: input.organizationId,
        branchId: input.branchId,
        code: input.code,
        name: input.name,
        isActive: true,
      },
      0,
      1,
    );
  }

  /** Rehydrate an already-persisted warehouse from repository data. */
  static reconstitute(state: WarehouseState & { version: number }): Warehouse {
    return new Warehouse({ ...state }, state.version, state.version);
  }

  get id(): string {
    return this.state.id;
  }

  get organizationId(): string {
    return this.state.organizationId;
  }

  get branchId(): string {
    return this.state.branchId;
  }

  get code(): string {
    return this.state.code;
  }

  get name(): string {
    return this.state.name;
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
   * Domain command: DeactivateWarehouse.
   *
   * Deactivating the LAST ACTIVE warehouse of a branch is allowed — no
   * architecture rule forbids it, so none is invented here; the resulting
   * WarehouseDeactivated event is the audit record. Repeated deactivation of
   * an already-inactive warehouse is an accepted no-op that emits nothing.
   */
  deactivate(): boolean {
    if (!this.state.isActive) {
      return false;
    }
    this.state.isActive = false;
    this._version += 1;
    return true;
  }

  /** Commit the pending version after a successful persist. */
  markPersisted(): void {
    this._expectedVersion = this._version;
  }
}
