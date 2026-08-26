import type { InventoryDomainEvent } from './events';
import { validateAdjustmentReason } from './invariants';

/**
 * StockAdjustment entity (docs/architecture/15-inventory.md).
 *
 * An immutable audit record for manual stock corrections. Adjustments are
 * the only way to modify stock quantities directly — all other mutations go
 * through receipts, consumptions, reservations, allocations or transfers.
 *
 * Adjustment types:
 * - INCREASE: adds stock (e.g. finding misplaced inventory).
 * - DECREASE: removes stock (e.g. damage, expiry).
 * - CORRECTION: sets stock to a new value (quantityAfter is the new absolute).
 *
 * Key business rules:
 * - reason is mandatory (validated at creation).
 * - approvedBy is required for decreases and corrections (enforced by
 *   STOCK_ADJUSTMENT_APPROVAL_REQUIRED at the application layer).
 * - Adjustments are immutable once created.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export type AdjustmentType = 'INCREASE' | 'DECREASE' | 'CORRECTION';

export interface StockAdjustmentState {
  readonly id: string;
  readonly organizationId: string;
  readonly stockPositionId: string;
  readonly adjustmentType: AdjustmentType;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
  readonly reason: string;
  readonly approvedBy: string | null;
  readonly referenceType: string | null;
  readonly referenceId: string | null;
}

export class StockAdjustment {
  private readonly domainEvents: InventoryDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    private readonly state: StockAdjustmentState,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: ApplyAdjustment.
   *
   * Creates a new adjustment entity. The reason is mandatory. The caller is
   * responsible for:
   * 1. Validating approval requirements at the application layer.
   * 2. Calling StockPosition.increaseOnHand() or decreaseOnHand() as appropriate.
   * 3. Persisting both the adjustment and the stock position change atomically.
   *
   * Emits an AdjustmentApplied event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      stockPositionId: string;
      adjustmentType: AdjustmentType;
      quantityBefore: number;
      quantityAfter: number;
      reason: string;
      approvedBy?: string | null;
      referenceType?: string | null;
      referenceId?: string | null;
    },
    options: StockAdjustmentOptions = {},
  ): StockAdjustment {
    validateAdjustmentReason(input.reason);

    const clockFn = options.clock ?? (() => new Date());

    const entity = new StockAdjustment(
      {
        id: input.id,
        organizationId: input.organizationId,
        stockPositionId: input.stockPositionId,
        adjustmentType: input.adjustmentType,
        quantityBefore: input.quantityBefore,
        quantityAfter: input.quantityAfter,
        reason: input.reason,
        approvedBy: input.approvedBy ?? null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
      },
      clockFn,
    );

    entity.pendingInsert = true;

    entity.domainEvents.push({
      type: 'AdjustmentApplied',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      aggregateId: input.id,
      stockPositionId: input.stockPositionId,
      adjustmentType: input.adjustmentType,
      quantityBefore: input.quantityBefore,
      quantityAfter: input.quantityAfter,
    });

    return entity;
  }

  /**
   * Rehydrate a persisted adjustment from repository data. No events emitted.
   */
  static reconstitute(
    state: StockAdjustmentState,
    options: StockAdjustmentOptions = {},
  ): StockAdjustment {
    return new StockAdjustment({ ...state }, options.clock ?? (() => new Date()));
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get id(): string {
    return this.state.id;
  }

  get organizationId(): string {
    return this.state.organizationId;
  }

  get stockPositionId(): string {
    return this.state.stockPositionId;
  }

  get adjustmentType(): AdjustmentType {
    return this.state.adjustmentType;
  }

  get quantityBefore(): number {
    return this.state.quantityBefore;
  }

  get quantityAfter(): number {
    return this.state.quantityAfter;
  }

  get reason(): string {
    return this.state.reason;
  }

  get approvedBy(): string | null {
    return this.state.approvedBy;
  }

  get referenceType(): string | null {
    return this.state.referenceType;
  }

  get referenceId(): string | null {
    return this.state.referenceId;
  }

  /** The delta between before and after. Positive for increases, negative for decreases. */
  get delta(): number {
    return this.state.quantityAfter - this.state.quantityBefore;
  }

  get hasPendingChanges(): boolean {
    return this.pendingInsert;
  }

  // ---------------------------------------------------------------------------
  // Persistence collaboration
  // ---------------------------------------------------------------------------

  pullDomainEvents(): InventoryDomainEvent[] {
    return this.domainEvents.splice(0, this.domainEvents.length);
  }

  markPersisted(): void {
    this.pendingInsert = false;
  }
}

export interface StockAdjustmentOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}
