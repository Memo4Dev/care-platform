import { PlatformError } from '@commerce-platform/contracts';

import type { Channel, PriceType, PricingDomainEvent } from './events';

/**
 * PriceEntry aggregate root — a single price point within a price book.
 *
 * Each entry binds a price for a specific variant + unit + price type +
 * channel combination. Branch-specific prices (with a non-null branchId)
 * take precedence over org-wide prices (null branchId) during quote
 * resolution.
 *
 * Effective dating allows scheduled price changes: the entry is only
 * active when the current date falls within [effectiveFrom, effectiveTo].
 * Either bound may be null (open-ended).
 *
 * All money amounts are stored as numeric strings — never floating point.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export class PriceEntry {
  private readonly domainEvents: PricingDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    readonly priceBookId: string,
    readonly variantId: string,
    readonly unitId: string,
    readonly priceType: PriceType,
    readonly channel: Channel,
    readonly branchId: string | null,
    private _amount: string,
    readonly effectiveFrom: Date | null,
    readonly effectiveTo: Date | null,
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {}

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreatePriceEntry.
   *
   * Creates a new price entry. The amount must be a positive numeric string.
   * If both effectiveFrom and effectiveTo are provided, effectiveFrom must
   * be strictly before effectiveTo.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      priceBookId: string;
      variantId: string;
      unitId: string;
      priceType: PriceType;
      channel: Channel;
      branchId?: string | null;
      amount: string;
      effectiveFrom?: Date | null;
      effectiveTo?: Date | null;
    },
    options: PriceEntryOptions = {},
  ): PriceEntry {
    assertPositiveAmount(input.amount);
    assertEffectiveDateOrder(input.effectiveFrom ?? null, input.effectiveTo ?? null);

    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new PriceEntry(
      input.id,
      input.organizationId,
      input.priceBookId,
      input.variantId,
      input.unitId,
      input.priceType,
      input.channel,
      input.branchId ?? null,
      input.amount,
      input.effectiveFrom ?? null,
      input.effectiveTo ?? null,
      0,
      1,
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'PriceEntryCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      priceEntryId: input.id,
      priceBookId: input.priceBookId,
      variantId: input.variantId,
      amount: input.amount,
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
      priceBookId: string;
      variantId: string;
      unitId: string;
      priceType: PriceType;
      channel: Channel;
      branchId: string | null;
      amount: string;
      effectiveFrom: Date | null;
      effectiveTo: Date | null;
      version: number;
    },
    options: PriceEntryOptions = {},
  ): PriceEntry {
    return new PriceEntry(
      state.id,
      state.organizationId,
      state.priceBookId,
      state.variantId,
      state.unitId,
      state.priceType,
      state.channel,
      state.branchId,
      state.amount,
      state.effectiveFrom,
      state.effectiveTo,
      state.version,
      state.version,
      options.clock ?? (() => new Date()),
    );
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get amount(): string {
    return this._amount;
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
   * Check whether this entry is effective at the given date.
   * An entry is effective when:
   * - effectiveFrom is null or the given date >= effectiveFrom
   * - effectiveTo is null or the given date < effectiveTo
   */
  isEffectiveAt(date: Date): boolean {
    if (this.effectiveFrom !== null && date < this.effectiveFrom) {
      return false;
    }
    if (this.effectiveTo !== null && date >= this.effectiveTo) {
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: UpdatePriceEntry.
   *
   * Updates the amount of an existing price entry. Emits a PriceEntryUpdated
   * event. Effective dates and other identifying fields are immutable —
   * creating a new entry with different dates is the supported pattern.
   */
  update(input: { amount: string }): void {
    assertPositiveAmount(input.amount);

    this._amount = input.amount;
    this.bumpVersion();

    this.domainEvents.push({
      type: 'PriceEntryUpdated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      priceEntryId: this.id,
      priceBookId: this.priceBookId,
      variantId: this.variantId,
      amount: input.amount,
    });
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

export interface PriceEntryOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}

function assertPositiveAmount(value: string): void {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw PlatformError.validationFailed(
      `Price amount must be a positive number, got "${value}".`,
      { details: { field: 'amount', value } },
    );
  }
}

function assertEffectiveDateOrder(effectiveFrom: Date | null, effectiveTo: Date | null): void {
  if (effectiveFrom !== null && effectiveTo !== null && effectiveFrom >= effectiveTo) {
    throw PlatformError.validationFailed('effectiveFrom must be strictly before effectiveTo.', {
      details: {
        field: 'effectiveFrom',
        effectiveFrom: effectiveFrom.toISOString(),
        effectiveTo: effectiveTo.toISOString(),
      },
    });
  }
}
