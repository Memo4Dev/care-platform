import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type { PurchasingDomainEvent } from './events';

/**
 * Supplier aggregate root (docs/architecture/16-purchasing.md).
 *
 * Supplier is an external vendor identity within one organization. `code` is a
 * business-level identifier unique per organization. `isActive` enables a
 * soft-disable without destroying purchase history.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle, no Inventory.
 */
export class Supplier {
  private readonly domainEvents: PurchasingDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _name: string,
    private _code: string,
    private _contactName: string | null,
    private _email: string | null,
    private _phone: string | null,
    private _address: string | null,
    private _isActive: boolean,
    private _notes: string | null,
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreateSupplier.
   *
   * Validates the business key and emits a SupplierCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      name: string;
      code: string;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      notes?: string | null;
    },
    options: SupplierOptions = {},
  ): Supplier {
    if (!input.id || input.id.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Supplier id is mandatory.', {
        details: { id: input.id },
      });
    }
    if (!input.organizationId || input.organizationId.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'organizationId is mandatory.', {
        details: { organizationId: input.organizationId },
      });
    }
    if (!input.name || input.name.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Supplier name is mandatory.', {
        details: { name: input.name },
      });
    }
    if (!input.code || input.code.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Supplier code is mandatory.', {
        details: { code: input.code },
      });
    }

    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new Supplier(
      input.id,
      input.organizationId,
      input.name.trim(),
      input.code.trim(),
      input.contactName ?? null,
      input.email ?? null,
      input.phone ?? null,
      input.address ?? null,
      true, // isActive
      input.notes ?? null,
      0, // expectedVersion
      1, // version
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'SupplierCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      aggregateId: input.id,
      name: aggregate._name,
      code: aggregate._code,
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
      code: string;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      isActive: boolean;
      notes?: string | null;
      version: number;
    },
    options: SupplierOptions = {},
  ): Supplier {
    return new Supplier(
      state.id,
      state.organizationId,
      state.name,
      state.code,
      state.contactName ?? null,
      state.email ?? null,
      state.phone ?? null,
      state.address ?? null,
      state.isActive,
      state.notes ?? null,
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

  get code(): string {
    return this._code;
  }

  get contactName(): string | null {
    return this._contactName;
  }

  get email(): string | null {
    return this._email;
  }

  get phone(): string | null {
    return this._phone;
  }

  get address(): string | null {
    return this._address;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  get notes(): string | null {
    return this._notes;
  }

  get version(): number {
    return this._version;
  }

  get expectedVersion(): number {
    return this._expectedVersion;
  }

  get hasPendingChanges(): boolean {
    return this.pendingInsert || this._version !== this._expectedVersion;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: update the supplier display name.
   * Emits a SupplierUpdated event.
   */
  updateName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Supplier name is mandatory.', {
        details: { name },
      });
    }

    this._name = name.trim();
    this.bumpVersion();

    this.domainEvents.push({
      type: 'SupplierUpdated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      name: this._name,
    });
  }

  /**
   * Domain command: update supplier profile fields (name, contact, address,
   * notes). Emits a SupplierUpdated event.
   */
  updateProfile(data: {
    name?: string;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    notes?: string | null;
  }): void {
    if (data.name !== undefined) {
      if (!data.name || data.name.trim().length === 0) {
        throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Supplier name is mandatory.', {
          details: { name: data.name },
        });
      }
      this._name = data.name.trim();
    }
    if (data.contactName !== undefined) this._contactName = data.contactName;
    if (data.email !== undefined) this._email = data.email;
    if (data.phone !== undefined) this._phone = data.phone;
    if (data.address !== undefined) this._address = data.address;
    if (data.notes !== undefined) this._notes = data.notes;

    this.bumpVersion();

    this.domainEvents.push({
      type: 'SupplierUpdated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      name: this._name,
    });
  }

  /**
   * Domain command: deactivate the supplier (soft-disable).
   * Emits a SupplierDeactivated event; throws if already inactive.
   */
  deactivate(): void {
    if (!this._isActive) {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        'Supplier is already inactive.',
        { details: { aggregateId: this.id, isActive: this._isActive } },
      );
    }

    this._isActive = false;
    this.bumpVersion();

    this.domainEvents.push({
      type: 'SupplierDeactivated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
    });
  }

  // ---------------------------------------------------------------------------
  // Persistence collaboration
  // ---------------------------------------------------------------------------

  pullDomainEvents(): PurchasingDomainEvent[] {
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

export interface SupplierOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}
