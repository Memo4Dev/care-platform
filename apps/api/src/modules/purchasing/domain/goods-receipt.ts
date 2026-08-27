import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';

import {
  validateGRStatusTransition,
  validateNonNegativeQuantity,
  validatePositiveQuantity,
  validateReceiptCompleteness,
} from './invariants';
import type {
  GoodsReceiptCostEventData,
  GoodsReceiptItemEventData,
  PurchasingDomainEvent,
} from './events';

/**
 * Goods Receipt status values and type (docs/architecture/16-purchasing.md).
 * Mirrors the persistence enum but lives in the domain to avoid importing
 * Drizzle schema.
 */
export const GOODS_RECEIPT_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const;
export type GoodsReceiptStatus = (typeof GOODS_RECEIPT_STATUSES)[number];

/** Additional cost types that feed Actual Cost / landed-cost allocation. */
export const PURCHASE_COST_TYPES = ['SHIPPING', 'CUSTOMS', 'HANDLING', 'OTHER'] as const;
export type PurchaseCostType = (typeof PURCHASE_COST_TYPES)[number];

/** A goods receipt line item (child entity within the aggregate). */
export interface GoodsReceiptItem {
  readonly id: string;
  readonly purchaseOrderItemId: string;
  readonly variantId: string;
  readonly quantityReceived: number;
  readonly quantityAccepted: number;
  readonly quantityRejected: number;
  readonly unitCost: number;
  readonly notes: string | null;
}

/** Input for a goods receipt line item (create). */
export interface GRItemInput {
  readonly id: string;
  readonly purchaseOrderItemId: string;
  readonly variantId: string;
  readonly quantityReceived: number;
  readonly quantityAccepted: number;
  readonly quantityRejected?: number;
  readonly unitCost: number;
  readonly notes?: string | null;
}

/** An additional purchase cost (child entity within the aggregate). */
export interface GoodsReceiptCost {
  readonly id: string;
  readonly costType: PurchaseCostType;
  readonly amount: number;
  readonly description: string | null;
}

/** Input for an additional purchase cost (create). */
export interface GRCostInput {
  readonly id: string;
  readonly costType: PurchaseCostType;
  readonly amount: number;
  readonly description?: string | null;
}

/**
 * Goods Receipt aggregate root (docs/architecture/16-purchasing.md).
 *
 * Owns its line items and additional costs as embedded child entities. A goods
 * receipt is received against a Purchase Order but is a separate aggregate.
 *
 * Lifecycle: PENDING → CONFIRMED | CANCELLED.
 * Once CONFIRMED the receipt is IMMUTABLE (no silent edits).
 *
 * Only the accepted quantity (per item) enters Inventory as FIFO layers; the
 * GoodsReceiptConfirmed event carries everything the Inventory consumer needs
 * to create those layers with correct landed cost.
 *
 * This file imports only plain contracts and the local invariants: no NestJS,
 * no Drizzle, no Inventory.
 */
export class GoodsReceipt {
  private readonly domainEvents: PurchasingDomainEvent[] = [];
  private pendingInsert = false;
  private readonly _items: GoodsReceiptItem[] = [];
  private readonly _costs: GoodsReceiptCost[] = [];

  private constructor(
    readonly id: string,
    readonly organizationId: string,
    private _purchaseOrderId: string,
    private _warehouseId: string,
    private _status: GoodsReceiptStatus,
    private _receivedDate: Date,
    private _notes: string | null,
    private _confirmedAt: Date | null,
    private _confirmedBy: string | null,
    items: GoodsReceiptItem[],
    costs: GoodsReceiptCost[],
    private _expectedVersion: number,
    private _version: number,
    private readonly clock: () => Date,
  ) {
    this._items.push(...items);
    this._costs.push(...costs);
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Domain command: CreateGoodsReceipt.
   *
   * Validates the PO/warehouse references, at least one valid line item, the
   * receipt completeness of each line, and any additional costs. Status starts
   * at PENDING. Emits a GoodsReceiptCreated event.
   */
  static create(
    input: {
      id: string;
      organizationId: string;
      purchaseOrderId: string;
      warehouseId: string;
      receivedDate?: Date;
      notes?: string | null;
      items: GRItemInput[];
      costs?: GRCostInput[];
    },
    options: GoodsReceiptOptions = {},
  ): GoodsReceipt {
    if (!input.id || input.id.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Goods receipt id is mandatory.', {
        details: { id: input.id },
      });
    }
    if (!input.organizationId || input.organizationId.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'organizationId is mandatory.', {
        details: { organizationId: input.organizationId },
      });
    }
    if (!input.purchaseOrderId || input.purchaseOrderId.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'purchaseOrderId is mandatory.', {
        details: { purchaseOrderId: input.purchaseOrderId },
      });
    }
    if (!input.warehouseId || input.warehouseId.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'warehouseId is mandatory.', {
        details: { warehouseId: input.warehouseId },
      });
    }
    if (!input.items || input.items.length === 0) {
      throw PlatformError.of(
        ERROR_CODES.VALIDATION_FAILED,
        'Goods receipt must have at least one item.',
        {
          details: { itemCount: input.items?.length ?? 0 },
        },
      );
    }

    const clockFn = options.clock ?? (() => new Date());
    const items = input.items.map((item, index) => GoodsReceipt.toItem(item, index));
    const costs = (input.costs ?? []).map((cost, index) => GoodsReceipt.toCost(cost, index));

    const aggregate = new GoodsReceipt(
      input.id,
      input.organizationId,
      input.purchaseOrderId,
      input.warehouseId,
      'PENDING',
      input.receivedDate ?? clockFn(),
      input.notes ?? null,
      null, // confirmedAt
      null, // confirmedBy
      items,
      costs,
      0, // expectedVersion
      1, // version
      clockFn,
    );

    aggregate.pendingInsert = true;

    aggregate.domainEvents.push({
      type: 'GoodsReceiptCreated',
      occurredAt: clockFn(),
      organizationId: input.organizationId,
      aggregateId: input.id,
      purchaseOrderId: input.purchaseOrderId,
      warehouseId: input.warehouseId,
      receivedDate: aggregate._receivedDate,
      notes: aggregate._notes,
      items: aggregate._items.map(GoodsReceipt.toItemEventData),
      costs: aggregate._costs.map(GoodsReceipt.toCostEventData),
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
      purchaseOrderId: string;
      warehouseId: string;
      status: GoodsReceiptStatus;
      receivedDate: Date;
      notes?: string | null;
      confirmedAt?: Date | null;
      confirmedBy?: string | null;
      items: GoodsReceiptItem[];
      costs: GoodsReceiptCost[];
      version: number;
    },
    options: GoodsReceiptOptions = {},
  ): GoodsReceipt {
    return new GoodsReceipt(
      state.id,
      state.organizationId,
      state.purchaseOrderId,
      state.warehouseId,
      state.status,
      state.receivedDate,
      state.notes ?? null,
      state.confirmedAt ?? null,
      state.confirmedBy ?? null,
      state.items,
      state.costs,
      state.version,
      state.version,
      options.clock ?? (() => new Date()),
    );
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get purchaseOrderId(): string {
    return this._purchaseOrderId;
  }

  get warehouseId(): string {
    return this._warehouseId;
  }

  get status(): GoodsReceiptStatus {
    return this._status;
  }

  get receivedDate(): Date {
    return this._receivedDate;
  }

  get notes(): string | null {
    return this._notes;
  }

  get confirmedAt(): Date | null {
    return this._confirmedAt;
  }

  get confirmedBy(): string | null {
    return this._confirmedBy;
  }

  get items(): readonly GoodsReceiptItem[] {
    return this._items;
  }

  get costs(): readonly GoodsReceiptCost[] {
    return this._costs;
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

  /** Total of all additional cost amounts. */
  get totalAdditionalCosts(): number {
    return this._costs.reduce((sum, cost) => sum + cost.amount, 0);
  }

  /** Sum of all items' accepted quantities (the quantity that enters Inventory). */
  get totalAcceptedQuantity(): number {
    return this._items.reduce((sum, item) => sum + item.quantityAccepted, 0);
  }

  // ---------------------------------------------------------------------------
  // Commands — lifecycle
  // ---------------------------------------------------------------------------

  /**
   * PENDING → CONFIRMED.
   *
   * The CRITICAL transition: it emits GoodsReceiptConfirmed, which the
   * Inventory consumer listens to in order to create FIFO layers (only the
   * accepted quantities) with landed cost. A confirmed receipt is immutable.
   */
  confirm(actorId: string): void {
    if (!actorId || actorId.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, 'Confirming actor id is mandatory.', {
        details: { actorId },
      });
    }
    if (this.totalAcceptedQuantity <= 0) {
      throw PlatformError.of(
        ERROR_CODES.VALIDATION_FAILED,
        'Goods receipt must have at least one item with an accepted quantity greater than zero.',
        { details: { totalAcceptedQuantity: this.totalAcceptedQuantity } },
      );
    }

    validateGRStatusTransition(this._status, 'CONFIRMED');

    const now = this.clock();
    this._confirmedAt = now;
    this._confirmedBy = actorId;
    this._status = 'CONFIRMED';
    this.bumpVersion();

    this.domainEvents.push({
      type: 'GoodsReceiptConfirmed',
      occurredAt: now,
      organizationId: this.organizationId,
      aggregateId: this.id,
      purchaseOrderId: this._purchaseOrderId,
      warehouseId: this._warehouseId,
      confirmedAt: now,
      confirmedBy: actorId,
      items: this._items.map(GoodsReceipt.toItemEventData),
      costs: this._costs.map(GoodsReceipt.toCostEventData),
      totalAcceptedQuantity: this.totalAcceptedQuantity,
      totalAdditionalCosts: this.totalAdditionalCosts,
    });
  }

  /** PENDING → CANCELLED. Only allowed while PENDING. */
  cancel(reason?: string | null): void {
    validateGRStatusTransition(this._status, 'CANCELLED');
    this._status = 'CANCELLED';
    this.bumpVersion();

    this.domainEvents.push({
      type: 'GoodsReceiptCancelled',
      occurredAt: this.clock(),
      organizationId: this.organizationId,
      aggregateId: this.id,
      reason: reason ?? null,
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

  private bumpVersion(): void {
    this._version += 1;
  }

  private static toItem(input: GRItemInput, index: number): GoodsReceiptItem {
    if (!input.id || input.id.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, `Item[${index}] id is mandatory.`, {
        details: { index },
      });
    }
    if (!input.purchaseOrderItemId || input.purchaseOrderItemId.trim().length === 0) {
      throw PlatformError.of(
        ERROR_CODES.VALIDATION_FAILED,
        `Item[${index}] purchaseOrderItemId is mandatory.`,
        {
          details: { index },
        },
      );
    }
    if (!input.variantId || input.variantId.trim().length === 0) {
      throw PlatformError.of(
        ERROR_CODES.VALIDATION_FAILED,
        `Item[${index}] variantId is mandatory.`,
        {
          details: { index },
        },
      );
    }

    const quantityRejected = input.quantityRejected ?? 0;
    validatePositiveQuantity(input.quantityReceived, `items[${index}].quantityReceived`);
    validatePositiveQuantity(input.quantityAccepted, `items[${index}].quantityAccepted`);
    validateNonNegativeQuantity(quantityRejected, `items[${index}].quantityRejected`);
    validatePositiveQuantity(input.unitCost, `items[${index}].unitCost`);
    validateReceiptCompleteness(input.quantityReceived, input.quantityAccepted, quantityRejected);

    return {
      id: input.id,
      purchaseOrderItemId: input.purchaseOrderItemId,
      variantId: input.variantId,
      quantityReceived: input.quantityReceived,
      quantityAccepted: input.quantityAccepted,
      quantityRejected,
      unitCost: input.unitCost,
      notes: input.notes ?? null,
    };
  }

  private static toCost(input: GRCostInput, index: number): GoodsReceiptCost {
    if (!input.id || input.id.trim().length === 0) {
      throw PlatformError.of(ERROR_CODES.VALIDATION_FAILED, `Cost[${index}] id is mandatory.`, {
        details: { index },
      });
    }
    if (!PURCHASE_COST_TYPES.includes(input.costType)) {
      throw PlatformError.of(
        ERROR_CODES.VALIDATION_FAILED,
        `Cost[${index}] has an unsupported cost type: ${input.costType}.`,
        {
          details: { index, costType: input.costType },
        },
      );
    }
    validatePositiveQuantity(input.amount, `costs[${index}].amount`);

    return {
      id: input.id,
      costType: input.costType,
      amount: input.amount,
      description: input.description ?? null,
    };
  }

  private static toItemEventData(item: GoodsReceiptItem): GoodsReceiptItemEventData {
    return {
      id: item.id,
      purchaseOrderItemId: item.purchaseOrderItemId,
      variantId: item.variantId,
      quantityReceived: item.quantityReceived,
      quantityAccepted: item.quantityAccepted,
      quantityRejected: item.quantityRejected,
      unitCost: item.unitCost,
      notes: item.notes,
    };
  }

  private static toCostEventData(cost: GoodsReceiptCost): GoodsReceiptCostEventData {
    return {
      id: cost.id,
      costType: cost.costType,
      amount: cost.amount,
      description: cost.description,
    };
  }
}

export interface GoodsReceiptOptions {
  /** Injectable clock for deterministic domain tests. Defaults to `new Date()`. */
  clock?: () => Date;
}
