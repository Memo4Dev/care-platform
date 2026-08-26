import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type { CatalogDomainEvent, ProductStatus } from './events';
import type { Variant } from './variant';

/**
 * Product aggregate root (docs/architecture/10-catalog.md).
 *
 * A product is the top-level sellable concept in the catalog: it carries a
 * name, description and lifecycle status. Concrete purchasing units and
 * barcodes are modeled as Variant entities owned by this aggregate.
 *
 * Lifecycle: DRAFT -> ACTIVE -> DISCONTINUED. Once discontinued a product
 * cannot be reactivated — the terminal state is an intentional business
 * decision (discontinued products leave the catalog permanently).
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export class Product {
  private readonly domainEvents: CatalogDomainEvent[] = [];
  private readonly _variants: Variant[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _name: string,
    private _description: string,
    private _status: ProductStatus,
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreateProduct.
   *
   * New products start in DRAFT status — they are not sellable until
   * explicitly activated. Emits exactly one ProductCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      name: string;
      description?: string;
    },
    options: ProductOptions = {},
  ): Product {
    const name = assertNonEmpty(input.name, 'name');
    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new Product(
      input.id,
      input.organizationId,
      name,
      input.description ?? '',
      'DRAFT',
      0,
      1,
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'ProductCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      productId: input.id,
      name,
      status: 'DRAFT',
    });

    return aggregate;
  }

  /**
   * Rehydrate a persisted aggregate from repository data. No events are
   * emitted during rehydration.
   *
   * Variants are passed separately so the repository can load them alongside
   * the product root in a single transaction boundary.
   */
  static reconstitute(
    state: {
      id: string;
      organizationId: string;
      name: string;
      description: string;
      status: ProductStatus;
      version: number;
    },
    options: ProductOptions = {},
  ): Product {
    const aggregate = new Product(
      state.id,
      state.organizationId,
      state.name,
      state.description,
      state.status,
      state.version,
      state.version,
      options.clock ?? (() => new Date()),
    );

    if (options.variants) {
      aggregate._variants.push(...options.variants);
    }

    return aggregate;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get name(): string {
    return this._name;
  }

  get description(): string {
    return this._description;
  }

  get status(): ProductStatus {
    return this._status;
  }

  get expectedVersion(): number {
    return this._expectedVersion;
  }

  get version(): number {
    return this._version;
  }

  get hasPendingChanges(): boolean {
    return (
      this.pendingInsert ||
      this._version !== this._expectedVersion ||
      this._variants.some((v) => v.hasPendingChanges)
    );
  }

  get variants(): readonly Variant[] {
    return this._variants;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: UpdateProduct.
   *
   * Updates mutable product fields. Any non-empty change emits a
   * ProductUpdated event.
   */
  update(input: { name?: string; description?: string }): void {
    if (input.name !== undefined) {
      const name = assertNonEmpty(input.name, 'name');
      this._name = name;
    }
    if (input.description !== undefined) {
      this._description = input.description;
    }
    this.bumpVersion();

    this.domainEvents.push({
      type: 'ProductUpdated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      productId: this.id,
      name: this._name,
    });
  }

  /**
   * Domain command: ActivateProduct (DRAFT -> ACTIVE).
   *
   * Activating an already-active product is an invalid transition.
   */
  activate(): void {
    if (this._status === 'ACTIVE') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Product ${this.id} is already active.`,
        { details: { productId: this.id, status: this._status } },
      );
    }
    if (this._status === 'DISCONTINUED') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Product ${this.id} is discontinued and cannot be reactivated.`,
        { details: { productId: this.id, status: this._status } },
      );
    }
    this._status = 'ACTIVE';
    this.bumpVersion();
    this.domainEvents.push({
      type: 'ProductActivated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      productId: this.id,
    });
  }

  /**
   * Domain command: DiscontinueProduct (ACTIVE|DRAFT -> DISCONTINUED).
   *
   * Discontinuing an already-discontinued product is an invalid transition.
   * Discontinuation is a terminal action — there is no reactivation command.
   */
  discontinue(): void {
    if (this._status === 'DISCONTINUED') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Product ${this.id} is already discontinued.`,
        { details: { productId: this.id, status: this._status } },
      );
    }
    this._status = 'DISCONTINUED';
    this.bumpVersion();
    this.domainEvents.push({
      type: 'ProductDiscontinued',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      productId: this.id,
    });
  }

  // ---------------------------------------------------------------------------
  // Variant commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: AddVariant.
   *
   * Adds a new variant to this product. The variant must not already exist
   * in this aggregate. Emits a VariantAdded event and bumps the product version.
   */
  addVariant(variant: Variant): void {
    const exists = this._variants.some((v) => v.id === variant.id);
    if (exists) {
      throw PlatformError.of(
        ERROR_CODES.VALIDATION_FAILED,
        `Variant ${variant.id} already exists in product ${this.id}.`,
        { details: { productId: this.id, variantId: variant.id } },
      );
    }
    this._variants.push(variant);
    this.bumpVersion();

    this.domainEvents.push({
      type: 'VariantAdded',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      variantId: variant.id,
      productId: this.id,
      name: variant.name,
      sku: variant.sku,
    });
  }

  /**
   * Load a variant by ID from this aggregate.
   * Returns null if the variant is not part of this aggregate.
   */
  getVariant(variantId: string): Variant | undefined {
    return this._variants.find((v) => v.id === variantId);
  }

  // ---------------------------------------------------------------------------
  // Persistence collaboration
  // ---------------------------------------------------------------------------

  pullDomainEvents(): CatalogDomainEvent[] {
    return this.domainEvents.splice(0, this.domainEvents.length);
  }

  markPersisted(): void {
    this._expectedVersion = this._version;
    this.pendingInsert = false;
    for (const variant of this._variants) {
      variant.markPersisted();
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private bumpVersion(): void {
    this._version += 1;
  }
}

export interface ProductOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
  /** Child variants loaded by the repository during rehydration. */
  variants?: Variant[];
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw PlatformError.validationFailed(`${field} must be a non-empty string.`, {
      details: { field },
    });
  }
  return value;
}
