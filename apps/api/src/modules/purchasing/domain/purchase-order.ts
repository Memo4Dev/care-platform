import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import { validatePositiveQuantity } from './invariants';
import { validatePOStatusTransition } from './invariants';
import type { PurchasingDomainEvent } from './events';
import type { PurchaseOrderItemEventData } from './events';

/**
 * Purchase Order status values and type (docs/architecture/16-purchasing.md).
 * Mirrors the persistence enum but lives in the domain to avoid importing
 * Drizzle schema.
 */
export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/** A purchase order line item (child entity within the aggregate). */
export interface PurchaseOrderItem {
  readonly id: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly unitCost: number;
  readonly packagingUnit: string | null;
  readonly packagingQuantity: number | null;
  readonly packagingConversion: number | null;
  readonly notes: string | null;
}

/** Mutable storage form of a purchase order line item (internal only). */
type MutablePurchaseOrderItem = {
  -readonly [K in keyof PurchaseOrderItem]: PurchaseOrderItem[K];
};

/** Input for a purchase order line item (create + addItem). */
export interface POItemInput {
  readonly id: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly unitCost: number;
  readonly packagingUnit?: string | null;
  readonly packagingQuantity?: number | null;
  readonly packagingConversion?: number | null;
  readonly notes?: string | null;
}

/** Partial update payload for a purchase order line item. */
export interface POItemUpdateInput {
  readonly variantId?: string;
  readonly quantity?: number;
  readonly unitCost?: number;
  readonly packagingUnit?: string | null;
  readonly packagingQuantity?: number | null;
  readonly packagingConversion?: number | null;
  readonly notes?: string | null;
}

/**
 * Purchase Order aggregate root (docs/architecture/16-purchasing.md).
 *
 * Owns its line items as embedded child entities. PO identity is independent:
 * multiple POs for the same Supplier + Variant are allowed (no uniqueness).
 *
 * Lifecycle:
 *   DRAFT → SUBMITTED → APPROVED → SENT → PARTIALLY_RECEIVED → RECEIVED
 *                                            ↘ CANCELLED
 *   SUBMITTED → REJECTED
 *   DRAFT     → CANCELLED
 *
 * Line items may only be mutated while the PO is DRAFT.
 *
 * This file imports only plain contracts and the local invariants: no NestJS,
 * no Drizzle, no Inventory.
 */
export class PurchaseOrder {
  private readonly domainEvents: PurchasingDomainEvent[] = [];
  private pendingInsert = false;
  private readonly _items: MutablePurchaseOrderItem[] = [];

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _supplierId: string,
    private _status: PurchaseOrderStatus,
    private _warehouseId: string,
    private _orderDate: Date,
    private _expectedDeliveryDate: Date | null,
    private _notes: string | null,
    items: PurchaseOrderItem[],
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {
    this._items.push(...items);
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreatePurchaseOrder.
   *
   * Validates the supplier/warehouse references and at least one valid line
   * item. Status starts at DRAFT. Emits a PurchaseOrderCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      supplierId: string;
      warehouseId: string;
      orderDate?: Date;
      expectedDeliveryDate?: Date | null;
      notes?: string | null;
      items: POItemInput[];
    },
    options: PurchaseOrderOptions = {},
  ): PurchaseOrder {
    if (!input.id || input.id.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Purchase order id is mandatory.', {
        details: { id: input.id },
      });
    }
    if (!input.organizationId || input.organizationId.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'organizationId is mandatory.', {
        details: { organizationId: input.organizationId },
      });
    }
    if (!input.supplierId || input.supplierId.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'supplierId is mandatory.', {
        details: { supplierId: input.supplierId },
      });
    }
    if (!input.warehouseId || input.warehouseId.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'warehouseId is mandatory.', {
        details: { warehouseId: input.warehouseId },
      });
    }
    if (!input.items || input.items.length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Purchase order must have at least one item.', {
        details: { itemCount: input.items?.length ?? 0 },
      });
    }

    const clockFn = options.clock ?? (() => new Date());
    const items = input.items.map((item, index) => PurchaseOrder.toItem(item, index));

    const aggregate = new PurchaseOrder(
      input.id,
      input.organizationId,
      input.supplierId,
      'DRAFT',
      input.warehouseId,
      input.orderDate ?? clockFn(),
      input.expectedDeliveryDate ?? null,
      input.notes ?? null,
      items,
      0, // expectedVersion
      1, // version
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'PurchaseOrderCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      aggregateId: input.id,
      supplierId: input.supplierId,
      warehouseId: input.warehouseId,
      orderDate: aggregate._orderDate,
      expectedDeliveryDate: aggregate._expectedDeliveryDate,
      notes: aggregate._notes,
      items: aggregate._items.map(PurchaseOrder.toItemEventData),
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
      supplierId: string;
      status: PurchaseOrderStatus;
      warehouseId: string;
      orderDate: Date;
      expectedDeliveryDate?: Date | null;
      notes?: string | null;
      items: PurchaseOrderItem[];
      version: number;
    },
    options: PurchaseOrderOptions = {},
  ): PurchaseOrder {
    return new PurchaseOrder(
      state.id,
      state.organizationId,
      state.supplierId,
      state.status,
      state.warehouseId,
      state.orderDate,
      state.expectedDeliveryDate ?? null,
      state.notes ?? null,
      state.items,
      state.version,
      state.version,
      options.clock ?? (() => new Date()),
    );
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get supplierId(): string {
    return this._supplierId;
  }

  get status(): PurchaseOrderStatus {
    return this._status;
  }

  get warehouseId(): string {
    return this._warehouseId;
  }

  get orderDate(): Date {
    return this._orderDate;
  }

  get expectedDeliveryDate(): Date | null {
    return this._expectedDeliveryDate;
  }

  get notes(): string | null {
    return this._notes;
  }

  get items(): readonly PurchaseOrderItem[] {
    return this._items as readonly PurchaseOrderItem[];
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
  // Commands — lifecycle
  // ---------------------------------------------------------------------------

  /** DRAFT → SUBMITTED */
  submit(): void {
    this.transition('SUBMITTED');
    this.domainEvents.push({
      type: 'PurchaseOrderSubmitted',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
    });
  }

  /** SUBMITTED → APPROVED */
  approve(): void {
    this.transition('APPROVED');
    this.domainEvents.push({
      type: 'PurchaseOrderApproved',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
    });
  }

  /** SUBMITTED → REJECTED */
  reject(reason?: string | null): void {
    this.transition('REJECTED');
    this.domainEvents.push({
      type: 'PurchaseOrderRejected',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      reason: reason ?? null,
    });
  }

  /** APPROVED → SENT */
  send(): void {
    this.transition('SENT');
    this.domainEvents.push({
      type: 'PurchaseOrderSent',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
    });
  }

  /** DRAFT | SUBMITTED | APPROVED | SENT → CANCELLED */
  cancel(reason?: string | null): void {
    this.transition('CANCELLED');
    this.domainEvents.push({
      type: 'PurchaseOrderCancelled',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      reason: reason ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Commands — line items (DRAFT only)
  // ---------------------------------------------------------------------------

  /** Add a line item. Only allowed while DRAFT. */
  addItem(data: POItemInput): void {
    this.assertDraft();
    const item = PurchaseOrder.toItem(data, this._items.length);
    this._items.push(item);
    this.bumpVersion();

    this.domainEvents.push({
      type: 'PurchaseOrderItemAdded',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      item: PurchaseOrder.toItemEventData(item),
    });
  }

  /** Update a line item. Only allowed while DRAFT. */
  updateItem(itemId: string, data: POItemUpdateInput): void {
    this.assertDraft();
    const item = this.findItem(itemId);

    if (data.variantId !== undefined) {
      if (!data.variantId || data.variantId.trim().length === 0) {
        throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'variantId is mandatory.', {
          details: { variantId: data.variantId },
        });
      }
      item.variantId = data.variantId;
    }
    if (data.quantity !== undefined) {
      validatePositiveQuantity(data.quantity, 'quantity');
      item.quantity = data.quantity;
    }
    if (data.unitCost !== undefined) {
      validatePositiveQuantity(data.unitCost, 'unitCost');
      item.unitCost = data.unitCost;
    }
    if (data.packagingUnit !== undefined) {
      item.packagingUnit = data.packagingUnit ?? null;
    }
    if (data.packagingQuantity !== undefined) {
      if (data.packagingQuantity !== null) {
        validatePositiveQuantity(data.packagingQuantity, 'packagingQuantity');
      }
      item.packagingQuantity = data.packagingQuantity ?? null;
    }
    if (data.packagingConversion !== undefined) {
      if (data.packagingConversion !== null) {
        validatePositiveQuantity(data.packagingConversion, 'packagingConversion');
      }
      item.packagingConversion = data.packagingConversion ?? null;
    }
    if (data.notes !== undefined) {
      item.notes = data.notes ?? null;
    }

    this.bumpVersion();

    this.domainEvents.push({
      type: 'PurchaseOrderItemUpdated',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      itemId: item.id,
      variantId: item.variantId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      packagingUnit: item.packagingUnit,
      packagingQuantity: item.packagingQuantity,
      packagingConversion: item.packagingConversion,
      notes: item.notes,
    });
  }

  /** Remove a line item. Only allowed while DRAFT; at least one item remains. */
  removeItem(itemId: string): void {
    this.assertDraft();
    const index = this._items.findIndex((i) => i.id === itemId);
    if (index === -1) {
      throw PlatformError.of(ERROR_CODES.RESOURCE_NOT_FOUND, `Purchase order item not found: ${itemId}.`, {
        details: { itemId },
      });
    }
    if (this._items.length <= 1) {
      throw PlatformError.of(
        ERROR_CODES.VALIDATION_FAILED,
        'Purchase order must retain at least one item.',
        { details: { itemCount: this._items.length } },
      );
    }

    this._items.splice(index, 1);
    this.bumpVersion();

    this.domainEvents.push({
      type: 'PurchaseOrderItemRemoved',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      itemId,
    });
  }

  // ---------------------------------------------------------------------------
  // Persistence collaboration
  // ---------------------------------------------------------------------------

  pullDomainEvents(): PurchasingDomainEvent[] {
    return this.domainEvents.splice(0, this.domainEvents.length);
  }

  markPersisted(): void {
    this._expectedVersion = this._version;
    this.pendingInsert = false;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private transition(target: PurchaseOrderStatus): void {
    validatePOStatusTransition(this._status, target);
    this._status = target;
    this.bumpVersion();
  }

  private assertDraft(): void {
    if (this._status !== 'DRAFT') {
      throw PlatformError.of(
        ERROR_CODES.OPERATION_NOT_ALLOWED,
        `Line items can only be modified while the purchase order is DRAFT (current: ${this._status}).`,
        { details: { status: this._status } },
      );
    }
  }

  private findItem(itemId: string): MutablePurchaseOrderItem {
    const item = this._items.find((i) => i.id === itemId);
    if (!item) {
      throw PlatformError.of(ERROR_CODES.RESOURCE_NOT_FOUND, `Purchase order item not found: ${itemId}.`, {
        details: { itemId },
      });
    }
    return item;
  }

  private bumpVersion(): void {
    this._version += 1;
  }

  private static toItem(input: POItemInput, index: number): MutablePurchaseOrderItem {
    if (!input.id || input.id.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, `Item[${index}] id is mandatory.`, {
        details: { index },
      });
    }
    if (!input.variantId || input.variantId.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, `Item[${index}] variantId is mandatory.`, {
        details: { index },
      });
    }
    validatePositiveQuantity(input.quantity, `items[${index}].quantity`);
    validatePositiveQuantity(input.unitCost, `items[${index}].unitCost`);
    if (input.packagingQuantity !== undefined && input.packagingQuantity !== null) {
      validatePositiveQuantity(input.packagingQuantity, `items[${index}].packagingQuantity`);
    }
    if (input.packagingConversion !== undefined && input.packagingConversion !== null) {
      validatePositiveQuantity(input.packagingConversion, `items[${index}].packagingConversion`);
    }

    return {
      id: input.id,
      variantId: input.variantId,
      quantity: input.quantity,
      unitCost: input.unitCost,
      packagingUnit: input.packagingUnit ?? null,
      packagingQuantity: input.packagingQuantity ?? null,
      packagingConversion: input.packagingConversion ?? null,
      notes: input.notes ?? null,
    };
  }

  private static toItemEventData(item: PurchaseOrderItem): PurchaseOrderItemEventData {
    return {
      id: item.id,
      variantId: item.variantId,
      quantity: item.quantity,
      unitCost: item.unitCost,
      packagingUnit: item.packagingUnit,
      packagingQuantity: item.packagingQuantity,
      packagingConversion: item.packagingConversion,
      notes: item.notes,
    };
  }
}

export interface PurchaseOrderOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}
