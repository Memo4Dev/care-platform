import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type { InventoryDomainEvent } from './events';
import { FIFOLayer } from './fifo-layer';
import { validateAvailableConstraint, validateNonNegativeQuantity } from './invariants';

/**
 * StockPosition aggregate root (docs/architecture/15-inventory.md).
 *
 * StockPosition is the identity of inventory: Organization + Warehouse + Variant.
 * It owns FIFO cost layers as child entities within its aggregate boundary.
 *
 * Core formula: Available = OnHand - Reserved - Allocated
 *
 * Key business rules:
 * - No direct quantity edits; corrections via StockAdjustments.
 * - onHand, reserved, allocated must all be non-negative.
 * - reserved + allocated <= onHand (always).
 * - FIFO consumption is oldest-first (by receivedAt ASC, then id ASC).
 * - Reservations and Allocations reduce Available but not OnHand.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export class StockPosition {
  private readonly domainEvents: InventoryDomainEvent[] = [];
  private readonly _layers: FIFOLayer[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private readonly _warehouseId: string,
    private readonly _variantId: string,
    private _onHand: number,
    private _reserved: number,
    private _allocated: number,
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreateStockPosition.
   *
   * New positions start with zero balances. Emits a StockPositionCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      warehouseId: string;
      variantId: string;
    },
    options: StockPositionOptions = {},
  ): StockPosition {
    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new StockPosition(
      input.id,
      input.organizationId,
      input.warehouseId,
      input.variantId,
      0, // onHand
      0, // reserved
      0, // allocated
      0, // expectedVersion
      1, // version
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'StockPositionCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      aggregateId: input.id,
      warehouseId: input.warehouseId,
      variantId: input.variantId,
    });

    return aggregate;
  }

  /**
   * Rehydrate a persisted aggregate from repository data. No events are
   * emitted during rehydration.
   *
   * FIFO layers are passed separately so the repository can load them
   * alongside the stock position root in a single transaction boundary.
   */
  static reconstitute(
    state: {
      id: string;
      organizationId: string;
      warehouseId: string;
      variantId: string;
      onHand: number;
      reserved: number;
      allocated: number;
      version: number;
    },
    options: StockPositionOptions = {},
  ): StockPosition {
    const aggregate = new StockPosition(
      state.id,
      state.organizationId,
      state.warehouseId,
      state.variantId,
      state.onHand,
      state.reserved,
      state.allocated,
      state.version,
      state.version,
      options.clock ?? (() => new Date()),
    );

    if (options.layers) {
      aggregate._layers.push(...options.layers);
    }

    return aggregate;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get warehouseId(): string {
    return this._warehouseId;
  }

  get variantId(): string {
    return this._variantId;
  }

  get onHand(): number {
    return this._onHand;
  }

  get reserved(): number {
    return this._reserved;
  }

  get allocated(): number {
    return this._allocated;
  }

  /** Available = OnHand - Reserved - Allocated */
  get available(): number {
    return this._onHand - this._reserved - this._allocated;
  }

  get version(): number {
    return this._version;
  }

  get expectedVersion(): number {
    return this._expectedVersion;
  }

  get hasPendingChanges(): boolean {
    return (
      this.pendingInsert ||
      this._version !== this._expectedVersion ||
      this._layers.some((l) => l.hasPendingChanges)
    );
  }

  get layers(): readonly FIFOLayer[] {
    return this._layers;
  }

  /**
   * Returns FIFO-sorted active layers (receivedAt ASC, then id ASC).
   * Only layers with remainingQuantity > 0 are included.
   */
  getActiveLayers(): FIFOLayer[] {
    return this._layers
      .filter((l) => !l.isFullyConsumed)
      .sort((a, b) => {
        const timeDiff = a.receivedAt.getTime() - b.receivedAt.getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
      });
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: Receive stock (receipt, adjustment increase).
   *
   * Increases onHand and creates a new FIFO cost layer. Emits a StockReceived
   * event.
   */
  increaseOnHand(quantity: number, unitCost: number, layerId?: string): void {
    validateNonNegativeQuantity(quantity, 'quantity');

    if (quantity === 0) {
      return;
    }

    this._onHand += quantity;
    this.validateInvariants();

    const clockFn = this.clock;
    const now = clockFn();

    const layer = FIFOLayer.create({
      id: layerId ?? `fifo-${this.id}-${now.getTime()}`,
      stockPositionId: this.id,
      receivedAt: now,
      quantity,
      unitCost,
    });

    this._layers.push(layer);
    this.bumpVersion();

    this.domainEvents.push({
      type: 'StockReceived',
      occurredAt: now,
      organizationId: this.organizationId,
      aggregateId: this.id,
      warehouseId: this._warehouseId,
      variantId: this._variantId,
      quantity,
      unitCost,
    });
  }

  /**
   * Domain command: Consume stock (FIFO).
   *
   * Decreases onHand by consuming from the oldest FIFO layers first.
   * Used when a sale completes or stock is otherwise consumed.
   * Emits a StockConsumed event.
   */
  decreaseOnHand(quantity: number): void {
    validateNonNegativeQuantity(quantity, 'quantity');

    if (quantity === 0) {
      return;
    }

    const activeLayers = this.getActiveLayers();

    // Validate FIFO consumption before mutating
    const totalRemaining = activeLayers.reduce((sum, l) => sum + l.remainingQuantity, 0);
    if (totalRemaining < quantity) {
      throw PlatformError.of(
        ERROR_CODES.INVENTORY_INSUFFICIENT,
        `Insufficient stock: requested ${quantity}, available ${totalRemaining} across ${activeLayers.length} layer(s).`,
        { details: { requested: quantity, available: totalRemaining } },
      );
    }

    // Consume from oldest layers first
    let remaining = quantity;
    for (const layer of activeLayers) {
      if (remaining <= 0) break;
      const consumeFromLayer = Math.min(layer.remainingQuantity, remaining);
      layer.consume(consumeFromLayer);
      remaining -= consumeFromLayer;
    }

    this._onHand -= quantity;
    this.validateInvariants();
    this.bumpVersion();

    this.domainEvents.push({
      type: 'StockConsumed',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      warehouseId: this._warehouseId,
      variantId: this._variantId,
      quantity,
    });
  }

  /**
   * Domain command: Reserve stock.
   *
   * Increases reserved, reducing available without touching onHand.
   * Emits a StockReserved event.
   */
  reserve(quantity: number): void {
    validateNonNegativeQuantity(quantity, 'quantity');

    if (quantity === 0) {
      return;
    }

    if (this.available < quantity) {
      throw PlatformError.of(
        ERROR_CODES.INVENTORY_INSUFFICIENT,
        `Insufficient available stock: requested ${quantity}, available ${this.available}.`,
        { details: { requested: quantity, available: this.available } },
      );
    }

    this._reserved += quantity;
    this.validateInvariants();
    this.bumpVersion();

    this.domainEvents.push({
      type: 'StockReserved',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      warehouseId: this._warehouseId,
      variantId: this._variantId,
      quantity,
    });
  }

  /**
   * Domain command: Release reservation.
   *
   * Decreases reserved, restoring available.
   */
  releaseReservation(quantity: number): void {
    validateNonNegativeQuantity(quantity, 'quantity');

    if (quantity === 0) {
      return;
    }

    if (this._reserved < quantity) {
      throw PlatformError.of(
        ERROR_CODES.RESERVATION_NOT_AVAILABLE,
        `Cannot release ${quantity}: only ${this._reserved} reserved.`,
        { details: { requested: quantity, reserved: this._reserved } },
      );
    }

    this._reserved -= quantity;
    this.validateInvariants();
    this.bumpVersion();
  }

  /**
   * Domain command: Allocate stock.
   *
   * Increases allocated, reducing available without touching onHand.
   * The corresponding Allocation aggregate emits the AllocationCreated event.
   */
  allocate(quantity: number): void {
    validateNonNegativeQuantity(quantity, 'quantity');

    if (quantity === 0) {
      return;
    }

    if (this.available < quantity) {
      throw PlatformError.of(
        ERROR_CODES.ALLOCATION_INSUFFICIENT,
        `Insufficient available stock for allocation: requested ${quantity}, available ${this.available}.`,
        { details: { requested: quantity, available: this.available } },
      );
    }

    this._allocated += quantity;
    this.validateInvariants();
    this.bumpVersion();
  }

  /**
   * Domain command: Release allocation.
   *
   * Decreases allocated, restoring available.
   */
  releaseAllocation(quantity: number): void {
    validateNonNegativeQuantity(quantity, 'quantity');

    if (quantity === 0) {
      return;
    }

    if (this._allocated < quantity) {
      throw PlatformError.of(
        ERROR_CODES.ALLOCATION_INSUFFICIENT,
        `Cannot release allocation of ${quantity}: only ${this._allocated} allocated.`,
        { details: { requested: quantity, allocated: this._allocated } },
      );
    }

    this._allocated -= quantity;
    this.validateInvariants();
    this.bumpVersion();
  }

  /**
   * Domain command: Dispatch transfer (outbound).
   *
   * Decreases onHand for stock leaving this warehouse. The destination
   * warehouse stock increases only when the transfer is received.
   */
  dispatchTransfer(quantity: number): void {
    validateNonNegativeQuantity(quantity, 'quantity');

    if (quantity === 0) {
      return;
    }

    if (this._onHand < quantity) {
      throw PlatformError.of(
        ERROR_CODES.INVENTORY_INSUFFICIENT,
        `Insufficient stock for transfer dispatch: requested ${quantity}, onHand ${this._onHand}.`,
        { details: { requested: quantity, onHand: this._onHand } },
      );
    }

    this._onHand -= quantity;
    this.validateInvariants();
    this.bumpVersion();
  }

  /**
   * Domain command: Receive transfer (inbound).
   *
   * Increases onHand for stock arriving at this warehouse. Creates a FIFO
   * layer to track the cost of transferred goods.
   */
  receiveTransfer(quantity: number, unitCost: number, layerId?: string): void {
    validateNonNegativeQuantity(quantity, 'quantity');

    if (quantity === 0) {
      return;
    }

    this._onHand += quantity;
    this.validateInvariants();

    const now = this.clock();

    const layer = FIFOLayer.create({
      id: layerId ?? `fifo-transfer-${this.id}-${now.getTime()}`,
      stockPositionId: this.id,
      receivedAt: now,
      quantity,
      unitCost,
    });

    this._layers.push(layer);
    this.bumpVersion();
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
    for (const layer of this._layers) {
      layer.markPersisted();
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private bumpVersion(): void {
    this._version += 1;
  }

  private validateInvariants(): void {
    validateAvailableConstraint(this._onHand, this._reserved, this._allocated);
  }
}

export interface StockPositionOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
  /** Child FIFO layers loaded by the repository during rehydration. */
  layers?: FIFOLayer[];
}
