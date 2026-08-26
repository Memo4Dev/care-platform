import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type { PricingDomainEvent } from './events';

/**
 * Coupon aggregate root — a redeemable code tied to a promotion.
 *
 * Coupons are the redemption mechanism for promotions: a customer presents
 * a coupon code at checkout, and the system validates it against the coupon
 * aggregate's constraints (expiry, usage limits, minimum order amount).
 *
 * Each coupon references a promotion and carries its own usage tracking
 * (usedCount vs maxUses) and validity window.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export class Coupon {
  private readonly domainEvents: PricingDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _code: string,
    readonly type: string,
    private _value: string,
    readonly promotionId: string,
    readonly maxUses: number | null,
    private _usedCount: number,
    readonly minOrderAmount: string | null,
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
   * Domain command: CreateCoupon.
   *
   * Creates a new coupon. The code must be unique within the organization
   * (enforced at the database level). Emits exactly one CouponCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      code: string;
      type: string;
      value: string;
      promotionId: string;
      maxUses?: number | null;
      minOrderAmount?: string | null;
      startDate?: Date | null;
      endDate?: Date | null;
    },
    options: CouponOptions = {},
  ): Coupon {
    const code = assertNonEmpty(input.code, 'code');
    const value = assertNonEmpty(input.value, 'value');
    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new Coupon(
      input.id,
      input.organizationId,
      code.toUpperCase(),
      input.type,
      value,
      input.promotionId,
      input.maxUses ?? null,
      0,
      input.minOrderAmount ?? null,
      input.startDate ?? null,
      input.endDate ?? null,
      true,
      0,
      1,
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'CouponCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      couponId: input.id,
      code: code.toUpperCase(),
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
      code: string;
      type: string;
      value: string;
      promotionId: string;
      maxUses: number | null;
      usedCount: number;
      minOrderAmount: string | null;
      startDate: Date | null;
      endDate: Date | null;
      isActive: boolean;
      version: number;
    },
    options: CouponOptions = {},
  ): Coupon {
    return new Coupon(
      state.id,
      state.organizationId,
      state.code,
      state.type,
      state.value,
      state.promotionId,
      state.maxUses,
      state.usedCount,
      state.minOrderAmount,
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

  get code(): string {
    return this._code;
  }

  get value(): string {
    return this._value;
  }

  get usedCount(): number {
    return this._usedCount;
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
   * Check whether this coupon is currently valid (active and within the
   * date window and usage limits).
   */
  isValid(): boolean {
    if (!this._isActive) {
      return false;
    }
    const now = this.clock();
    if (this.startDate !== null && now < this.startDate) {
      return false;
    }
    if (this.endDate !== null && now >= this.endDate) {
      return false;
    }
    if (this.maxUses !== null && this._usedCount >= this.maxUses) {
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: RedeemCoupon.
   *
   * Increments the usage counter. The caller (application layer) must
   * validate that the coupon is valid before calling this method. Domain
   * invariant checks are:
   * - coupon must be active
   * - coupon must not be expired
   * - coupon must not have reached maxUses
   *
   * Emits a CouponRedeemed event.
   */
  redeem(): void {
    if (!this._isActive) {
      throw PlatformError.of(ERROR_CODES.COUPON_INVALID, `Coupon "${this._code}" is not active.`, {
        details: { couponId: this.id, code: this._code },
      });
    }

    const now = this.clock();
    if (this.startDate !== null && now < this.startDate) {
      throw PlatformError.of(
        ERROR_CODES.COUPON_EXPIRED,
        `Coupon "${this._code}" is not yet valid.`,
        {
          details: { couponId: this.id, code: this._code, startDate: this.startDate.toISOString() },
        },
      );
    }
    if (this.endDate !== null && now >= this.endDate) {
      throw PlatformError.of(ERROR_CODES.COUPON_EXPIRED, `Coupon "${this._code}" has expired.`, {
        details: { couponId: this.id, code: this._code, endDate: this.endDate.toISOString() },
      });
    }
    if (this.maxUses !== null && this._usedCount >= this.maxUses) {
      throw PlatformError.of(
        ERROR_CODES.COUPON_INVALID,
        `Coupon "${this._code}" has reached its maximum uses (${this.maxUses}).`,
        {
          details: {
            couponId: this.id,
            code: this._code,
            maxUses: this.maxUses,
            usedCount: this._usedCount,
          },
        },
      );
    }

    this._usedCount += 1;
    this.bumpVersion();

    this.domainEvents.push({
      type: 'CouponRedeemed',
      occurredAt: now,
      organizationId: this.organizationId,
      couponId: this.id,
      code: this._code,
      usedCount: this._usedCount,
    });
  }

  /**
   * Domain command: DeactivateCoupon.
   *
   * Deactivating an already-inactive coupon is an accepted no-op that
   * emits nothing.
   */
  deactivate(): boolean {
    if (!this._isActive) {
      return false;
    }
    this._isActive = false;
    this.bumpVersion();

    this.domainEvents.push({
      type: 'CouponDeactivated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      couponId: this.id,
      code: this._code,
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

export interface CouponOptions {
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
