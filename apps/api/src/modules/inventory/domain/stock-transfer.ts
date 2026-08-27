import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type {
  InventoryDomainEvent,
  TransferCancelledEvent,
  TransferCreatedEvent,
  TransferDispatchedEvent,
  TransferReceivedEvent,
} from './events';
import { validateTransferState } from './invariants';

/**
 * StockTransfer aggregate root (docs/architecture/15-inventory.md).
 *
 * Transfer of stock from one warehouse to another within the same organization.
 *
 * Lifecycle: DRAFT → DISPATCHED → IN_TRANSIT → RECEIVED | CANCELLED
 * - DRAFT: transfer created, items being prepared.
 * - DISPATCHED: items left the source warehouse, dispatched_at set.
 * - IN_TRANSIT: items are in transit (set automatically or manually).
 * - RECEIVED: items arrived at destination, received_at set.
 * - CANCELLED: transfer was cancelled. Only allowed from DRAFT or DISPATCHED.
 *
 * Key business rules:
 * - Source and destination must be different warehouses.
 * - Cannot cancel after IN_TRANSIT.
 * - Source stock decreases on dispatch; destination stock increases on receipt.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export type StockTransferStatus = 'DRAFT' | 'DISPATCHED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';

export class StockTransfer {
  private readonly domainEvents: InventoryDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private readonly _sourceWarehouseId: string,
    private readonly _destinationWarehouseId: string,
    private _status: StockTransferStatus,
    private _dispatchedAt: Date | null,
    private _receivedAt: Date | null,
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreateTransfer.
   *
   * Creates a new transfer in DRAFT status. Validates that source and
   * destination warehouses are different. Emits a TransferCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      sourceWarehouseId: string;
      destinationWarehouseId: string;
    },
    options: StockTransferOptions = {},
  ): StockTransfer {
    if (input.sourceWarehouseId === input.destinationWarehouseId) {
      throw PlatformError.of(
        ERROR_CODES.VALIDATION_FAILED,
        'Source and destination warehouses must be different.',
        {
          details: {
            sourceWarehouseId: input.sourceWarehouseId,
            destinationWarehouseId: input.destinationWarehouseId,
          },
        },
      );
    }

    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new StockTransfer(
      input.id,
      input.organizationId,
      input.sourceWarehouseId,
      input.destinationWarehouseId,
      'DRAFT',
      null,
      null,
      0,
      1,
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'TransferCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      aggregateId: input.id,
      sourceWarehouseId: input.sourceWarehouseId,
      destinationWarehouseId: input.destinationWarehouseId,
    } satisfies TransferCreatedEvent);

    return aggregate;
  }

  /**
   * Rehydrate a persisted transfer from repository data. No events emitted.
   */
  static reconstitute(
    state: {
      id: string;
      organizationId: string;
      sourceWarehouseId: string;
      destinationWarehouseId: string;
      status: StockTransferStatus;
      dispatchedAt: Date | null;
      receivedAt: Date | null;
      version: number;
    },
    options: StockTransferOptions = {},
  ): StockTransfer {
    return new StockTransfer(
      state.id,
      state.organizationId,
      state.sourceWarehouseId,
      state.destinationWarehouseId,
      state.status,
      state.dispatchedAt,
      state.receivedAt,
      state.version,
      state.version,
      options.clock ?? (() => new Date()),
    );
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get sourceWarehouseId(): string {
    return this._sourceWarehouseId;
  }

  get destinationWarehouseId(): string {
    return this._destinationWarehouseId;
  }

  get status(): StockTransferStatus {
    return this._status;
  }

  get dispatchedAt(): Date | null {
    return this._dispatchedAt;
  }

  get receivedAt(): Date | null {
    return this._receivedAt;
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
   * Domain command: DispatchTransfer (DRAFT → DISPATCHED).
   *
   * Sets dispatched_at to the current time. Source stock should be decreased
   * by the caller (StockPosition.dispatchTransfer).
   * Emits a TransferDispatched event.
   */
  dispatchTransfer(): void {
    validateTransferState(this._status, 'DISPATCHED');
    this._status = 'DISPATCHED';
    this._dispatchedAt = this.clock();
    this.bumpVersion();

    this.domainEvents.push({
      type: 'TransferDispatched',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
    } satisfies TransferDispatchedEvent);
  }

  /**
   * Domain command: MarkInTransit (DISPATCHED → IN_TRANSIT).
   *
   * Optional transition — transfers can go directly from DISPATCHED to
   * RECEIVED if there is no explicit in-transit tracking.
   */
  markInTransit(): void {
    validateTransferState(this._status, 'IN_TRANSIT');
    this._status = 'IN_TRANSIT';
    this.bumpVersion();
  }

  /**
   * Domain command: ReceiveTransfer (IN_TRANSIT → RECEIVED).
   *
   * Sets received_at to the current time. Destination stock should be
   * increased by the caller (StockPosition.receiveTransfer).
   * Emits a TransferReceived event.
   */
  receiveTransfer(): void {
    validateTransferState(this._status, 'RECEIVED');
    this._status = 'RECEIVED';
    this._receivedAt = this.clock();
    this.bumpVersion();

    this.domainEvents.push({
      type: 'TransferReceived',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
    } satisfies TransferReceivedEvent);
  }

  /**
   * Domain command: CancelTransfer (DRAFT|DISPATCHED → CANCELLED).
   *
   * Only allowed before IN_TRANSIT. After IN_TRANSIT the physical goods
   * are in transit and cannot be cancelled via this command.
   * Emits a TransferCancelled event.
   */
  cancelTransfer(): void {
    validateTransferState(this._status, 'CANCELLED');
    this._status = 'CANCELLED';
    this.bumpVersion();

    this.domainEvents.push({
      type: 'TransferCancelled',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
    } satisfies TransferCancelledEvent);
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

export interface StockTransferOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}
