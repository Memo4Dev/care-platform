import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type { VariantStatus } from './events';

/**
 * Variant entity — owned by the Product aggregate.
 *
 * A variant represents a concrete purchasable SKU within a product: it has
 * its own name, SKU, barcode, base unit, category assignment and lifecycle
 * status. Variants are NOT independent aggregate roots: every mutation goes
 * through the Product aggregate so that per-product invariants are enforced
 * in one place.
 *
 * Key invariant: once set, baseUnitId cannot be changed (changing the base
 * unit of a variant would invalidate all existing price entries and
 * inventory positions).
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export interface VariantState {
  readonly id: string;
  readonly organizationId: string;
  readonly productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  baseUnitId: string;
  categoryId: string | null;
  isActive: boolean;
}

export class Variant {
  private _status: VariantStatus = 'DRAFT';
  private _expectedVersion = 0;
  private _version = 1;

  private constructor(
    private readonly state: VariantState,
    status: VariantStatus,
    expectedVersion: number,
    version: number,
  ) {
    this._status = status;
    this._expectedVersion = expectedVersion;
    this._version = version;
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: AddVariant.
   *
   * A variant must have a non-empty baseUnitId — the base unit defines how
   * quantities of this variant are measured. Variants start in DRAFT status.
   */
  static create(input: {
    id: string;
    organizationId: string;
    productId: string;
    name: string;
    sku: string;
    barcode?: string | null;
    baseUnitId: string;
    categoryId?: string | null;
  }): Variant {
    const name = assertNonEmpty(input.name, 'name');
    const sku = assertNonEmpty(input.sku, 'sku');
    const baseUnitId = assertNonEmpty(input.baseUnitId, 'baseUnitId');

    return new Variant(
      {
        id: input.id,
        organizationId: input.organizationId,
        productId: input.productId,
        name,
        sku,
        barcode: input.barcode ?? null,
        baseUnitId,
        categoryId: input.categoryId ?? null,
        isActive: true,
      },
      'DRAFT',
      0,
      1,
    );
  }

  /** Rehydrate a persisted variant from repository data. */
  static reconstitute(state: VariantState & { status: VariantStatus; version: number }): Variant {
    return new Variant({ ...state }, state.status, state.version, state.version);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get id(): string {
    return this.state.id;
  }

  get organizationId(): string {
    return this.state.organizationId;
  }

  get productId(): string {
    return this.state.productId;
  }

  get name(): string {
    return this.state.name;
  }

  get sku(): string {
    return this.state.sku;
  }

  get barcode(): string | null {
    return this.state.barcode;
  }

  get baseUnitId(): string {
    return this.state.baseUnitId;
  }

  get categoryId(): string | null {
    return this.state.categoryId;
  }

  get isActive(): boolean {
    return this.state.isActive;
  }

  get status(): VariantStatus {
    return this._status;
  }

  get expectedVersion(): number {
    return this._expectedVersion;
  }

  get version(): number {
    return this._version;
  }

  get hasPendingChanges(): boolean {
    return this._version !== this._expectedVersion;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: UpdateVariant.
   *
   * Updates mutable variant fields. baseUnitId is intentionally excluded —
   * once set it cannot change. Emits a VariantUpdated event.
   */
  update(input: {
    name?: string;
    sku?: string;
    barcode?: string | null;
    categoryId?: string | null;
  }): void {
    if (input.name !== undefined) {
      this.state.name = assertNonEmpty(input.name, 'name');
    }
    if (input.sku !== undefined) {
      this.state.sku = assertNonEmpty(input.sku, 'sku');
    }
    if (input.barcode !== undefined) {
      this.state.barcode = input.barcode;
    }
    if (input.categoryId !== undefined) {
      this.state.categoryId = input.categoryId;
    }
    this._version += 1;
  }

  /**
   * Domain command: ActivateVariant (DRAFT -> ACTIVE).
   */
  activate(): void {
    if (this._status === 'ACTIVE') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Variant ${this.id} is already active.`,
        { details: { variantId: this.id, status: this._status } },
      );
    }
    if (this._status === 'DISCONTINUED') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Variant ${this.id} is discontinued and cannot be reactivated.`,
        { details: { variantId: this.id, status: this._status } },
      );
    }
    this._status = 'ACTIVE';
    this._version += 1;
  }

  /**
   * Domain command: DiscontinueVariant (ACTIVE|DRAFT -> DISCONTINUED).
   *
   * Discontinuation is terminal — a discontinued variant cannot be
   * reactivated. This mirrors the product lifecycle design.
   */
  discontinue(): void {
    if (this._status === 'DISCONTINUED') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Variant ${this.id} is already discontinued.`,
        { details: { variantId: this.id, status: this._status } },
      );
    }
    this._status = 'DISCONTINUED';
    this._version += 1;
  }

  // ---------------------------------------------------------------------------
  // Persistence collaboration
  // ---------------------------------------------------------------------------

  /** Expose the mutable state snapshot for the repository to persist. */
  toPersistenceState(): VariantState & { status: VariantStatus; version: number } {
    return {
      id: this.state.id,
      organizationId: this.state.organizationId,
      productId: this.state.productId,
      name: this.state.name,
      sku: this.state.sku,
      barcode: this.state.barcode,
      baseUnitId: this.state.baseUnitId,
      categoryId: this.state.categoryId,
      isActive: this.state.isActive,
      status: this._status,
      version: this._version,
    };
  }

  markPersisted(): void {
    this._expectedVersion = this._version;
  }
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw PlatformError.validationFailed(`${field} must be a non-empty string.`, {
      details: { field },
    });
  }
  return value;
}
