import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import type { CartDomainEvent } from './events';
import { addQuantities, normalizeQuantity } from './quantity';
import type { CartChannel, CartStatus } from './types';

export interface CartLineState {
  id: string;
  variantId: string;
  unitId: string;
  quantity: string;
}

export interface CartState {
  id: string;
  organizationId: string;
  branchId: string;
  channel: CartChannel;
  status: CartStatus;
  customerId: string | null;
  lines: CartLineState[];
  version: number;
}

/**
 * Framework-independent Cart aggregate.
 *
 * M5-004 intentionally supports only the editable Draft lifecycle. Hold,
 * reservation, conversion to Sale, and payment transitions are separate
 * commands in later milestones and therefore cannot be reached here.
 */
export class Cart {
  private readonly domainEvents: CartDomainEvent[] = [];
  private readonly _lines: CartLineState[];
  private pendingInsert = false;

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private readonly _branchId: string,
    private readonly _channel: CartChannel,
    private readonly _status: CartStatus,
    private readonly _customerId: string | null,
    lines: CartLineState[],
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {
    this._lines = lines.map((line) => ({ ...line, quantity: normalizeQuantity(line.quantity) }));
    this.validateInvariants();
  }

  /** Create an empty POS Draft Cart. Creating it never touches Inventory. */
  static create(input: {
    id: string;
    organizationId: string;
    branchId: string;
    channel?: CartChannel;
    customerId?: string | null;
    clock?: () => Date;
  }): Cart {
    const clock = input.clock ?? (() => new Date());
    const cart = new Cart(
      input.id,
      input.organizationId,
      input.branchId,
      input.channel ?? 'POS',
      'DRAFT',
      input.customerId ?? null,
      [],
      0,
      1,
      clock,
    );
    cart.pendingInsert = true;
    cart.domainEvents.push({
      type: 'CartCreated',
      occurredAt: clock(),
      organizationId: input.organizationId,
      aggregateId: input.id,
      aggregateVersion: cart.version,
      branchId: input.branchId,
      channel: cart.channel,
      customerId: cart.customerId,
    });
    return cart;
  }

  /** Rehydrate a persisted Cart without replaying historical events. */
  static reconstitute(state: CartState, clock: () => Date = () => new Date()): Cart {
    return new Cart(
      state.id,
      state.organizationId,
      state.branchId,
      state.channel,
      state.status,
      state.customerId,
      state.lines,
      state.version,
      state.version,
      clock,
    );
  }

  get branchId(): string {
    return this._branchId;
  }

  get channel(): CartChannel {
    return this._channel;
  }

  get status(): CartStatus {
    return this._status;
  }

  get customerId(): string | null {
    return this._customerId;
  }

  get lines(): readonly CartLineState[] {
    return this._lines.map((line) => ({ ...line }));
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

  /** Add a line, merging quantities for the same variant and unit. */
  addLine(input: { id: string; variantId: string; unitId: string; quantity: string }): void {
    this.ensureDraft();
    const quantity = normalizeQuantity(input.quantity);
    const existing = this._lines.find(
      (line) => line.variantId === input.variantId && line.unitId === input.unitId,
    );

    if (existing) {
      existing.quantity = addQuantities(existing.quantity, quantity);
    } else {
      this._lines.push({
        id: input.id,
        variantId: input.variantId,
        unitId: input.unitId,
        quantity,
      });
    }

    this.bumpVersion();
    this.domainEvents.push({
      type: 'CartLineAdded',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      aggregateVersion: this.version,
      lineId: existing?.id ?? input.id,
      variantId: input.variantId,
      unitId: input.unitId,
      quantity: existing?.quantity ?? quantity,
    });
  }

  /** Replace one existing line quantity. Zero is not a quantity; remove it instead. */
  updateLine(lineId: string, quantityInput: string): void {
    this.ensureDraft();
    const line = this.requireLine(lineId);
    const quantity = normalizeQuantity(quantityInput);
    if (line.quantity === quantity) return;

    line.quantity = quantity;
    this.bumpVersion();
    this.domainEvents.push({
      type: 'CartLineUpdated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      aggregateVersion: this.version,
      lineId,
      quantity,
    });
  }

  removeLine(lineId: string): void {
    this.ensureDraft();
    const index = this._lines.findIndex((line) => line.id === lineId);
    if (index < 0) {
      throw PlatformError.notFound(`Cart line ${lineId} was not found.`, {
        details: { cartId: this.id, lineId },
      });
    }

    this._lines.splice(index, 1);
    this.bumpVersion();
    this.domainEvents.push({
      type: 'CartLineRemoved',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      aggregateVersion: this.version,
      lineId,
    });
  }

  pullDomainEvents(): CartDomainEvent[] {
    return this.domainEvents.splice(0, this.domainEvents.length);
  }

  markPersisted(): void {
    this._expectedVersion = this._version;
    this.pendingInsert = false;
  }

  private ensureDraft(): void {
    if (this.status !== 'DRAFT') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Cart ${this.id} cannot be modified in status ${this.status}.`,
        { details: { cartId: this.id, status: this.status } },
      );
    }
  }

  private requireLine(lineId: string): CartLineState {
    const line = this._lines.find((candidate) => candidate.id === lineId);
    if (!line) {
      throw PlatformError.notFound(`Cart line ${lineId} was not found.`, {
        details: { cartId: this.id, lineId },
      });
    }
    return line;
  }

  private validateInvariants(): void {
    if (!this.id || !this.organizationId || !this.branchId) {
      throw PlatformError.validationFailed('Cart identity and tenant scope are required.');
    }
    if (this.status !== 'DRAFT') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Cart status ${this.status} is not supported by this Cart slice.`,
      );
    }
    const keys = new Set<string>();
    for (const line of this._lines) {
      const key = `${line.variantId}:${line.unitId}`;
      if (keys.has(key)) {
        throw PlatformError.validationFailed('Cart cannot contain duplicate variant/unit lines.', {
          details: { cartId: this.id, variantId: line.variantId, unitId: line.unitId },
        });
      }
      keys.add(key);
    }
  }

  private bumpVersion(): void {
    this._version += 1;
  }
}
