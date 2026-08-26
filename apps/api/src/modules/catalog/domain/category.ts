import { PlatformError } from '@commerce-platform/contracts';

import type { CatalogDomainEvent } from './events';

/**
 * Category aggregate root — a hierarchical classification of products.
 *
 * Categories form a tree: each category optionally references a parentId
 * (another category of the same organization). The tree structure allows
 * products to be organized into logical groupings for the storefront,
 * reporting and POS navigation.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export class Category {
  private readonly domainEvents: CatalogDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _parentId: string | null,
    private _name: string,
    private _description: string,
    private _sortOrder: number,
    private _isActive: boolean,
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreateCategory.
   *
   * Creates a new category. Parent is optional — top-level categories have
   * no parent. Emits exactly one CategoryCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      parentId?: string | null;
      name: string;
      description?: string;
      sortOrder?: number;
    },
    options: CategoryOptions = {},
  ): Category {
    const name = assertNonEmpty(input.name, 'name');
    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new Category(
      input.id,
      input.organizationId,
      input.parentId ?? null,
      name,
      input.description ?? '',
      input.sortOrder ?? 0,
      true,
      0,
      1,
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'CategoryCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      categoryId: input.id,
      name,
      parentId: input.parentId ?? null,
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
      organizationId: string;
      parentId: string | null;
      name: string;
      description: string;
      sortOrder: number;
      isActive: boolean;
      version: number;
    },
    options: CategoryOptions = {},
  ): Category {
    return new Category(
      state.id,
      state.organizationId,
      state.parentId,
      state.name,
      state.description,
      state.sortOrder,
      state.isActive,
      state.version,
      state.version,
      options.clock ?? (() => new Date()),
    );
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get parentId(): string | null {
    return this._parentId;
  }

  get name(): string {
    return this._name;
  }

  get description(): string {
    return this._description;
  }

  get sortOrder(): number {
    return this._sortOrder;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  get expectedVersion(): number {
    return this._expectedVersion;
  }

  get version(): number {
    return this._version;
  }

  get hasPendingChanges(): boolean {
    return this.pendingInsert || this._version !== this._expectedVersion;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: UpdateCategory.
   *
   * Updates mutable category fields. Emits a CategoryUpdated event.
   */
  update(input: { name?: string; description?: string; sortOrder?: number }): void {
    if (input.name !== undefined) {
      this._name = assertNonEmpty(input.name, 'name');
    }
    if (input.description !== undefined) {
      this._description = input.description;
    }
    if (input.sortOrder !== undefined) {
      this._sortOrder = input.sortOrder;
    }
    this.bumpVersion();

    this.domainEvents.push({
      type: 'CategoryUpdated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      categoryId: this.id,
      name: this._name,
    });
  }

  /**
   * Domain command: DeactivateCategory.
   *
   * Deactivating an already-inactive category is an accepted no-op that
   * emits nothing. This mirrors the Warehouse deactivate pattern from the
   * organization module.
   */
  deactivate(): boolean {
    if (!this._isActive) {
      return false;
    }
    this._isActive = false;
    this.bumpVersion();

    this.domainEvents.push({
      type: 'CategoryDeactivated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      categoryId: this.id,
    });
    return true;
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
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private bumpVersion(): void {
    this._version += 1;
  }
}

export interface CategoryOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw PlatformError.validationFailed(`${field} must be a non-empty string.`, {
      details: { field },
    });
  }
  return value;
}
