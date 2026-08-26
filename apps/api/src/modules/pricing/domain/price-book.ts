import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type { PricingDomainEvent } from './events';

/**
 * PriceBook aggregate root — a named collection of price entries.
 *
 * An organization may have multiple price books (e.g. "Retail", "Wholesale",
 * "Promotional"). Exactly one price book is marked as the default — the one
 * used when no specific price book is requested.
 *
 * Price books are organizational-wide. Branch-specific pricing is modeled at
 * the PriceEntry level via the optional branchId field.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export class PriceBook {
  private readonly domainEvents: PricingDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _name: string,
    private _description: string,
    private _isDefault: boolean,
    private _isActive: boolean,
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreatePriceBook.
   *
   * Creates a new price book. By default a price book is not the default
   * and is active. Emits exactly one PriceBookCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      name: string;
      description?: string;
      isDefault?: boolean;
    },
    options: PriceBookOptions = {},
  ): PriceBook {
    const name = assertNonEmpty(input.name, 'name');
    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new PriceBook(
      input.id,
      input.organizationId,
      name,
      input.description ?? '',
      input.isDefault ?? false,
      true,
      0,
      1,
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'PriceBookCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      priceBookId: input.id,
      name,
      isDefault: input.isDefault ?? false,
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
      name: string;
      description: string;
      isDefault: boolean;
      isActive: boolean;
      version: number;
    },
    options: PriceBookOptions = {},
  ): PriceBook {
    return new PriceBook(
      state.id,
      state.organizationId,
      state.name,
      state.description,
      state.isDefault,
      state.isActive,
      state.version,
      state.version,
      options.clock ?? (() => new Date()),
    );
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

  get isDefault(): boolean {
    return this._isDefault;
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
   * Domain command: SetDefaultPriceBook.
   *
   * Marks this price book as the organization's default. In a multi-aggregate
   * scenario the application layer must first unset the current default
   * before calling this on the new default. This method only mutates the
   * current aggregate's isDefault flag — the cross-aggregate coordination
   * happens at the application layer.
   *
   * Setting a default on an already-default price book is an invalid
   * transition.
   */
  setDefault(): void {
    if (this._isDefault) {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Price book ${this.id} is already the default.`,
        { details: { priceBookId: this.id } },
      );
    }
    this._isDefault = true;
    this.bumpVersion();

    this.domainEvents.push({
      type: 'PriceBookDefaultChanged',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      priceBookId: this.id,
      previousPriceBookId: null,
    });
  }

  /**
   * Domain command: DeactivatePriceBook.
   *
   * Deactivating an already-inactive price book is an accepted no-op that
   * emits nothing.
   */
  deactivate(): boolean {
    if (!this._isActive) {
      return false;
    }
    this._isActive = false;
    this.bumpVersion();

    this.domainEvents.push({
      type: 'PriceBookDeactivated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      priceBookId: this.id,
    });
    return true;
  }

  /**
   * Internal helper: clear the default flag without emitting an event.
   * Used by the application layer when coordinating default price book
   * changes across multiple price book aggregates.
   */
  clearDefault(): void {
    if (!this._isDefault) {
      return;
    }
    this._isDefault = false;
    this.bumpVersion();
  }

  // ---------------------------------------------------------------------------
  // Persistence collaboration
  // ---------------------------------------------------------------------------

  pullDomainEvents(): PricingDomainEvent[] {
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

export interface PriceBookOptions {
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
