import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type {
  InventoryDomainEvent,
  ReservationConsumedEvent,
  ReservationExpiredEvent,
  ReservationReleasedEvent,
} from './events';
import { validateReservationTransition } from './invariants';

/**
 * Reservation aggregate root (docs/architecture/15-inventory.md).
 *
 * A reservation is a temporary hold on stock (e.g. pending POS sale).
 * It reduces Available on the StockPosition but does not touch OnHand.
 *
 * Lifecycle: ACTIVE → CONSUMED | RELEASED | EXPIRED
 * - CONSUMED: when the sale completes (stock is actually consumed).
 * - RELEASED: when the reservation is explicitly cancelled.
 * - EXPIRED: when the expires_at timestamp has passed.
 *
 * Terminal states (CONSUMED, RELEASED, EXPIRED) cannot be transitioned from.
 *
 * This file imports only plain contracts: no NestJS, no Drizzle.
 */
export type ReservationStatus = 'ACTIVE' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';

export class Reservation {
  private readonly domainEvents: InventoryDomainEvent[] = [];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private readonly _stockPositionId: string,
    private _status: ReservationStatus,
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
   * Domain command: CreateReservation.
   *
   * Creates a new reservation in ACTIVE status. No events are emitted here —
   * the StockPosition emits the StockReserved event when reserve() is called.
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
    options: ReservationOptions = {},
  ): Reservation {
    const clockFn = options.clock ?? (() => new Date());

    const aggregate = new Reservation(
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
    return aggregate;
  }

  /**
   * Rehydrate a persisted reservation from repository data. No events emitted.
   */
  static reconstitute(
    state: {
      id: string;
      organizationId: string;
      stockPositionId: string;
      status: ReservationStatus;
      expiresAt: Date | null;
      referenceType: string | null;
      referenceId: string | null;
      version: number;
    },
    options: ReservationOptions = {},
  ): Reservation {
    return new Reservation(
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

  get status(): ReservationStatus {
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

  /** Whether the reservation has expired based on the current time. */
  get isExpired(): boolean {
    if (!this._expiresAt) return false;
    return this.clock() > this._expiresAt;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * Domain command: ConsumeReservation (ACTIVE → CONSUMED).
   *
   * Called when a sale completes and the reserved stock is actually consumed.
   * Emits a ReservationConsumed event.
   */
  consumeReservation(): void {
    if (this._status !== 'ACTIVE') {
      throw PlatformError.of(
        ERROR_CODES.RESERVATION_ALREADY_CONSUMED,
        `Reservation ${this.id} cannot be consumed: current status is ${this._status}.`,
        { details: { reservationId: this.id, status: this._status } },
      );
    }

    if (this.isExpired) {
      throw PlatformError.of(
        ERROR_CODES.RESERVATION_EXPIRED,
        `Reservation ${this.id} has expired.`,
        { details: { reservationId: this.id, expiresAt: this._expiresAt?.toISOString() } },
      );
    }

    validateReservationTransition(this._status, 'CONSUMED');
    this._status = 'CONSUMED';
    this.bumpVersion();

    this.domainEvents.push({
      type: 'ReservationConsumed',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      stockPositionId: this._stockPositionId,
    } satisfies ReservationConsumedEvent);
  }

  /**
   * Domain command: ReleaseReservation (ACTIVE → RELEASED).
   *
   * Called when a reservation is cancelled or no longer needed.
   * Emits a ReservationReleased event.
   */
  releaseReservation(): void {
    if (this._status !== 'ACTIVE') {
      throw PlatformError.of(
        ERROR_CODES.RESERVATION_NOT_AVAILABLE,
        `Reservation ${this.id} cannot be released: current status is ${this._status}.`,
        { details: { reservationId: this.id, status: this._status } },
      );
    }

    validateReservationTransition(this._status, 'RELEASED');
    this._status = 'RELEASED';
    this.bumpVersion();

    this.domainEvents.push({
      type: 'ReservationReleased',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      stockPositionId: this._stockPositionId,
    } satisfies ReservationReleasedEvent);
  }

  /**
   * Domain command: ExpireReservation (ACTIVE → EXPIRED).
   *
   * Called when the expires_at timestamp has passed.
   * Emits a ReservationExpired event.
   */
  expireReservation(): void {
    if (this._status !== 'ACTIVE') {
      throw PlatformError.of(
        ERROR_CODES.RESERVATION_NOT_AVAILABLE,
        `Reservation ${this.id} cannot be expired: current status is ${this._status}.`,
        { details: { reservationId: this.id, status: this._status } },
      );
    }

    validateReservationTransition(this._status, 'EXPIRED');
    this._status = 'EXPIRED';
    this.bumpVersion();

    this.domainEvents.push({
      type: 'ReservationExpired',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      stockPositionId: this._stockPositionId,
    } satisfies ReservationExpiredEvent);
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

export interface ReservationOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}
