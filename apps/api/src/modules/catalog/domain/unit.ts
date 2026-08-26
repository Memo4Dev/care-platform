import { PlatformError } from '@commerce-platform/contracts';

import type { CatalogDomainEvent } from './events';

/**
 * UnitDefinition aggregate — the base unit of measurement in the catalog.
 *
 * Units (e.g. "Piece", "Box", "Gram") define how product quantities are
 * expressed. Each unit belongs to one organization and may be flagged as
 * the base unit for that org. The base unit is the canonical denominator
 * for unit conversions.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export class UnitDefinition {
  private readonly domainEvents: CatalogDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _name: string,
    private _symbol: string,
    private _isBaseUnit: boolean,
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreateUnit.
   *
   * Creates a new unit definition for the organization. A unit may optionally
   * be designated as the base unit for unit conversions.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      name: string;
      symbol: string;
      isBaseUnit?: boolean;
    },
    options: UnitOptions = {},
  ): UnitDefinition {
    const name = assertNonEmpty(input.name, 'name');
    const symbol = assertNonEmpty(input.symbol, 'symbol');

    const aggregate = new UnitDefinition(
      input.id,
      input.organizationId,
      name,
      symbol,
      input.isBaseUnit ?? false,
      0,
      1,
      options.clock ?? (() => new Date()),
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'UnitCreated',
      occurredAt: aggregate.clock(),
      organizationId: aggregate.organizationId,
      unitId: aggregate.id,
      name: aggregate._name,
      symbol: aggregate._symbol,
      isBaseUnit: aggregate._isBaseUnit,
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
      symbol: string;
      isBaseUnit: boolean;
      version: number;
    },
    options: UnitOptions = {},
  ): UnitDefinition {
    return new UnitDefinition(
      state.id,
      state.organizationId,
      state.name,
      state.symbol,
      state.isBaseUnit,
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

  get symbol(): string {
    return this._symbol;
  }

  get isBaseUnit(): boolean {
    return this._isBaseUnit;
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
  // Persistence collaboration
  // ---------------------------------------------------------------------------

  pullDomainEvents(): CatalogDomainEvent[] {
    return this.domainEvents.splice(0, this.domainEvents.length);
  }

  markPersisted(): void {
    this._expectedVersion = this._version;
    this.pendingInsert = false;
  }
}

export interface UnitOptions {
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
