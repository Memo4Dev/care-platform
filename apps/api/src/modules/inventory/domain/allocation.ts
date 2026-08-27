import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type {
  AllocationCreatedEvent,
  AllocationConsumedEvent,
  AllocationExpiredEvent,
  AllocationReleasedEvent,
  InventoryDomainEvent,
} from './events';
import { validateAllocationTransition } from './invariants';

/**
 * Allocation aggregate root (docs/architecture/15-inventory.md).
 *
 * An allocation is a confirmed stock commitment (e.g. fulfilled order).
 * It reduces Available on the StockPosition but does not touch OnHand.
 *
 * Unlike reservations, allocations represent irreversible commitments in
 * practice — once consumed they cannot be released back. However the
 * domain model allows all terminal transitions for flexibility.
 *
 * Lifecycle: ACTIVE → CONSUMED | RELEASED | EXPIRED
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export type AllocationStatus = 'ACTIVE' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';

export class Allocation {
  private readonly domainEvents: InventoryDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private readonly _stockPositionId: string,
    private _status: AllocationStatus,
    private readonly _expiresAt: Date | null,
    private readonly _referenceType: string | null,
    private readonly _referenceId: string | null,
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreateAllocation.
   *
   * Creates a new allocation in ACTIVE status. The StockPosition.allocate()
   * command should be called separately to enforce the available constraint.
   * Emits an AllocationCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      stockPositionId: string;
      expiresAt?: Date | null;
      referenceType?: string | null;
      referenceId?: string | null;
    },
    options: AllocationOptions = {},
  ): Allocation {
    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new Allocation(
      input.id,
      input.organizationId,
      input.stockPositionId,
      'ACTIVE',
      input.expiresAt ?? null,
      input.referenceType ?? null,
      input.referenceId ?? null,
      0,
      1,
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'AllocationCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      aggregateId: input.id,
      stockPositionId: input.stockPositionId,
      quantity: 0, // actual quantity is tracked at the StockPosition level
    } satisfies AllocationCreatedEvent);

    return aggregate;
  }

  /**
   * Rehydrate a persisted allocation from repository data. No events emitted.
   */
  static reconstitute(
    state: {
      id: string;
      organizationId: string;
      stockPositionId: string;
      status: AllocationStatus;
      expiresAt: Date | null;
      referenceType: string | null;
      referenceId: string | null;
      version: number;
    },
    options: AllocationOptions = {},
  ): Allocation {
    return new Allocation(
      state.id,
      state.organizationId,
      state.stockPositionId,
      state.status,
      state.expiresAt,
      state.referenceType,
      state.referenceId,
      state.version,
      state.version,
      options.clock ?? (() => new Date()),
    );
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get stockPositionId(): string {
    return this._stockPositionId;
  }

  get status(): AllocationStatus {
    return this._status;
  }

  get expiresAt(): Date | null {
    return this._expiresAt;
  }

  get referenceType(): string | null {
    return this._referenceType;
  }

  get referenceId(): string | null {
    return this._referenceId;
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

  /** Whether the allocation has expired based on the current time. */
  get isExpired(): boolean {
    if (!this._expiresAt) return false;
    return this.clock() > this._expiresAt;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: ConsumeAllocation (ACTIVE → CONSUMED).
   *
   * Called when an order is fulfilled and the allocated stock is committed.
   * Emits an AllocationConsumed event.
   */
  consumeAllocation(): void {
    if (this._status !== 'ACTIVE') {
      throw PlatformError.of(
        ERROR_CODES.ALLOCATION_INSUFFICIENT,
        `Allocation ${this.id} cannot be consumed: current status is ${this._status}.`,
        { details: { allocationId: this.id, status: this._status } },
      );
    }

    if (this.isExpired) {
      throw PlatformError.of(
        ERROR_CODES.RESERVATION_EXPIRED,
        `Allocation ${this.id} has expired.`,
        { details: { allocationId: this.id, expiresAt: this._expiresAt?.toISOString() } },
      );
    }

    validateAllocationTransition(this._status, 'CONSUMED');
    this._status = 'CONSUMED';
    this.bumpVersion();

    this.domainEvents.push({
      type: 'AllocationConsumed',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      stockPositionId: this._stockPositionId,
    } satisfies AllocationConsumedEvent);
  }

  /**
   * Domain command: ReleaseAllocation (ACTIVE → RELEASED).
   *
   * Called when an allocation is cancelled before fulfillment.
   * Emits an AllocationReleased event.
   */
  releaseAllocation(): void {
    if (this._status !== 'ACTIVE') {
      throw PlatformError.of(
        ERROR_CODES.ALLOCATION_INSUFFICIENT,
        `Allocation ${this.id} cannot be released: current status is ${this._status}.`,
        { details: { allocationId: this.id, status: this._status } },
      );
    }

    validateAllocationTransition(this._status, 'RELEASED');
    this._status = 'RELEASED';
    this.bumpVersion();

    this.domainEvents.push({
      type: 'AllocationReleased',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      stockPositionId: this._stockPositionId,
    } satisfies AllocationReleasedEvent);
  }

  /**
   * Domain command: ExpireAllocation (ACTIVE → EXPIRED).
   *
   * Called when the expires_at timestamp has passed.
   * Emits an AllocationExpired event.
   */
  expireAllocation(): void {
    if (this._status !== 'ACTIVE') {
      throw PlatformError.of(
        ERROR_CODES.ALLOCATION_INSUFFICIENT,
        `Allocation ${this.id} cannot be expired: current status is ${this._status}.`,
        { details: { allocationId: this.id, status: this._status } },
      );
    }

    validateAllocationTransition(this._status, 'EXPIRED');
    this._status = 'EXPIRED';
    this.bumpVersion();

    this.domainEvents.push({
      type: 'AllocationExpired',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      stockPositionId: this._stockPositionId,
    } satisfies AllocationExpiredEvent);
  }

  // ---------------------------------------------------------------------------
  // Persistence collaboration
  // ---------------------------------------------------------------------------

  pullDomainEvents(): InventoryDomainEvent[] {
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

export interface AllocationOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}
