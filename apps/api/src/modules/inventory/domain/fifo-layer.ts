import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import { validateNonNegativeQuantity } from './invariants';

/**
 * FIFO cost layer entity (within StockPosition aggregate boundary).
 *
 * Each receipt creates a new layer with `quantity` = `remainingQuantity`.
 * Consumption decrements `remainingQuantity` oldest-first (by receivedAt ASC,
 * then id ASC). The layer itself does not emit events — events are emitted by
 * the owning StockPosition aggregate.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export class FIFOLayer {
  private _remainingQuantity: number;
  private _expectedVersion: number;
  private _version: number;
  private _consumed = false;

  private constructor(
    readonly id: string,
    readonly stockPositionId: string,
    readonly receivedAt: Date,
    readonly quantity: number,
    remainingQuantity: number,
    readonly unitCost: number,
    expectedVersion: number,
    version: number,
  ) {
    this._remainingQuantity = remainingQuantity;
    this._expectedVersion = expectedVersion;
    this._version = version;
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Create a new FIFO layer from a receipt.
   * The initial `remainingQuantity` equals the full `quantity`.
   */
  static create(input: {
    id: string;
    stockPositionId: string;
    receivedAt?: Date;
    quantity: number;
    unitCost: number;
  }): FIFOLayer {
    validateNonNegativeQuantity(input.quantity, 'quantity');
    validateNonNegativeQuantity(input.unitCost, 'unitCost');

    if (input.quantity === 0) {
      throw PlatformError.of(
        ERROR_CODES.VALIDATION_FAILED,
        'FIFO layer quantity must be greater than zero.',
        { details: { quantity: input.quantity } },
      );
    }

    return new FIFOLayer(
      input.id,
      input.stockPositionId,
      input.receivedAt ?? new Date(),
      input.quantity,
      input.quantity,
      input.unitCost,
      0,
      1,
    );
  }

  /**
   * Rehydrate a persisted layer from repository data. No events emitted.
   */
  static reconstitute(state: {
    id: string;
    stockPositionId: string;
    receivedAt: Date;
    quantity: number;
    remainingQuantity: number;
    unitCost: number;
    version: number;
  }): FIFOLayer {
    return new FIFOLayer(
      state.id,
      state.stockPositionId,
      state.receivedAt,
      state.quantity,
      state.remainingQuantity,
      state.unitCost,
      state.version,
      state.version,
    );
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get remainingQuantity(): number {
    return this._remainingQuantity;
  }

  get version(): number {
    return this._version;
  }

  get expectedVersion(): number {
    return this._expectedVersion;
  }

  get isFullyConsumed(): boolean {
    return this._remainingQuantity === 0;
  }

  get hasPendingChanges(): boolean {
    return this._consumed || this._version !== this._expectedVersion;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Check whether this layer can consume the requested quantity.
   */
  canConsume(quantity: number): boolean {
    validateNonNegativeQuantity(quantity, 'quantity');
    return this._remainingQuantity >= quantity;
  }

  /**
   * Consume a quantity from this layer. Reduces `remainingQuantity` and bumps
   * version. Throws INVENTORY_INSUFFICIENT if there is not enough remaining.
   */
  consume(quantity: number): void {
    validateNonNegativeQuantity(quantity, 'quantity');

    if (quantity === 0) {
      return;
    }

    if (this._remainingQuantity < quantity) {
      throw PlatformError.of(
        ERROR_CODES.INVENTORY_INSUFFICIENT,
        `FIFO layer ${this.id}: requested ${quantity} but only ${this._remainingQuantity} remaining.`,
        {
          details: {
            layerId: this.id,
            requested: quantity,
            remaining: this._remainingQuantity,
          },
        },
      );
    }

    this._remainingQuantity -= quantity;
    this._version += 1;
    this._consumed = true;
  }

  // ---------------------------------------------------------------------------
  // Persistence collaboration
  // ---------------------------------------------------------------------------

  markPersisted(): void {
    this._expectedVersion = this._version;
    this._consumed = false;
  }
}
