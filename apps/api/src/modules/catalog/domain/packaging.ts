import { PlatformError } from '@commerce-platform/contracts';

import type { CatalogDomainEvent } from './events';

/**
 * PackagingDefinition aggregate — defines how a product variant is packaged.
 *
 * A packaging definition represents a specific packaging unit (e.g. "Box of 12",
 * "Strip of 10") with a conversion factor relative to a parent packaging level.
 * The hierarchy allows: Piece -> Strip (factor 10) -> Box (factor 12), meaning
 * 1 Box = 12 Strips = 120 Pieces.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export class PackagingDefinition {
  private readonly domainEvents: CatalogDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _name: string,
    private _unitId: string,
    private _parentId: string | null,
    private _factor: string,
    private _sortOrder: number,
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreatePackagingDefinition.
   *
   * Creates a new packaging definition. Parent is optional — top-level
   * packaging (e.g. "Piece") has no parent and a factor of "1".
   * Emits exactly one PackagingDefinitionCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      name: string;
      unitId: string;
      parentId?: string | null;
      factor?: string;
      sortOrder?: number;
    },
    options: PackagingOptions = {},
  ): PackagingDefinition {
    const name = assertNonEmpty(input.name, 'name');
    const unitId = assertNonEmpty(input.unitId, 'unitId');
    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new PackagingDefinition(
      input.id,
      input.organizationId,
      name,
      unitId,
      input.parentId ?? null,
      input.factor ?? '1',
      input.sortOrder ?? 0,
      0,
      1,
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'PackagingDefinitionCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      packagingDefinitionId: input.id,
      name,
      unitId,
      parentId: input.parentId ?? null,
      factor: aggregate._factor,
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
      unitId: string;
      parentId: string | null;
      factor: string;
      sortOrder: number;
      version: number;
    },
    options: PackagingOptions = {},
  ): PackagingDefinition {
    return new PackagingDefinition(
      state.id,
      state.organizationId,
      state.name,
      state.unitId,
      state.parentId,
      state.factor,
      state.sortOrder,
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

  get unitId(): string {
    return this._unitId;
  }

  get parentId(): string | null {
    return this._parentId;
  }

  get factor(): string {
    return this._factor;
  }

  get sortOrder(): number {
    return this._sortOrder;
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

export interface PackagingOptions {
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
