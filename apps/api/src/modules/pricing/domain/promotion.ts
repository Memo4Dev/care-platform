import { PlatformError } from '@commerce-platform/contracts';

import type { PricingDomainEvent, PromotionTarget, PromotionType } from './events';

/**
 * Promotion aggregate root — a discount rule applicable to products, variants,
 * categories or entire orders.
 *
 * Promotions define a discount type (percentage, fixed amount, buy X get Y)
 * with optional quantity constraints and a validity window. The target field
 * indicates what the promotion applies to.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export class Promotion {
  private readonly domainEvents: PricingDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _name: string,
    readonly type: PromotionType,
    readonly target: PromotionTarget,
    private _value: string,
    readonly minQuantity: number | null,
    readonly maxQuantity: number | null,
    readonly startDate: Date | null,
    readonly endDate: Date | null,
    private _isActive: boolean,
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreatePromotion.
   *
   * Creates a new promotion. The value meaning depends on the type:
   * - PERCENTAGE: a numeric string representing the percentage (e.g. "10" for 10%)
   * - FIXED_AMOUNT: a numeric string representing the discount amount
   * - BUY_X_GET_Y: a numeric string encoding the buy/get quantities
   *
   * Emits exactly one PromotionCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      name: string;
      type: PromotionType;
      target: PromotionTarget;
      value: string;
      minQuantity?: number | null;
      maxQuantity?: number | null;
      startDate?: Date | null;
      endDate?: Date | null;
    },
    options: PromotionOptions = {},
  ): Promotion {
    const name = assertNonEmpty(input.name, 'name');
    const value = assertNonEmpty(input.value, 'value');
    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new Promotion(
      input.id,
      input.organizationId,
      name,
      input.type,
      input.target,
      value,
      input.minQuantity ?? null,
      input.maxQuantity ?? null,
      input.startDate ?? null,
      input.endDate ?? null,
      true,
      0,
      1,
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'PromotionCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      promotionId: input.id,
      name,
      promotionType: input.type,
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
      type: PromotionType;
      target: PromotionTarget;
      value: string;
      minQuantity: number | null;
      maxQuantity: number | null;
      startDate: Date | null;
      endDate: Date | null;
      isActive: boolean;
      version: number;
    },
    options: PromotionOptions = {},
  ): Promotion {
    return new Promotion(
      state.id,
      state.organizationId,
      state.name,
      state.type,
      state.target,
      state.value,
      state.minQuantity,
      state.maxQuantity,
      state.startDate,
      state.endDate,
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

  get value(): string {
    return this._value;
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

  /**
   * Check whether this promotion is currently valid (active and within the
   * date window).
   */
  isValidAt(date: Date): boolean {
    if (!this._isActive) {
      return false;
    }
    if (this.startDate !== null && date < this.startDate) {
      return false;
    }
    if (this.endDate !== null && date >= this.endDate) {
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: DeactivatePromotion.
   *
   * Deactivating an already-inactive promotion is an accepted no-op that
   * emits nothing.
   */
  deactivate(): boolean {
    if (!this._isActive) {
      return false;
    }
    this._isActive = false;
    this.bumpVersion();

    this.domainEvents.push({
      type: 'PromotionDeactivated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      promotionId: this.id,
    });
    return true;
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

export interface PromotionOptions {
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
