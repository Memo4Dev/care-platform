import type { DbExecutor } from './infrastructure/db-executor';

/**
 * Public module contract of the Inventory bounded context
 * (docs/architecture/60-module-contracts.md "Inventory").
 *
 * Other bounded contexts consume these queries and commands through the
 * {@link INVENTORY_CONTRACTS} injection token — never through this module's
 * repositories or tables. Reads are organizationId-scoped (Layer 2 tenant
 * isolation). Commands follow the same tenant-scoping rule.
 */

/** Nest injection token binding the Inventory context's contract provider. */
export const INVENTORY_CONTRACTS = Symbol('INVENTORY_CONTRACTS');
export const INVENTORY_MUTATION_CONTRACTS = Symbol('INVENTORY_MUTATION_CONTRACTS');

/** Availability projection exposed to other contexts. */
export interface AvailabilityView {
  stockPositionId: string;
  organizationId: string;
  warehouseId: string;
  variantId: string;
  onHand: string;
  reserved: string;
  allocated: string;
  /** Available = onHand - reserved - allocated, clamped to >= 0. */
  available: string;
}

/**
 * Input for receiving stock into Inventory from an external context
 * (e.g. Purchasing Goods Receipt confirmation).
 *
 * The caller is responsible for landed-cost calculation; Inventory stores
 * the `unitCost` as the FIFO layer cost. Only accepted quantity should be
 * passed here — rejected quantity never enters Inventory.
 */
export interface ReceiveStockInput {
  organizationId: string;
  warehouseId: string;
  variantId: string;
  /** Decimal string — positive quantity to receive. */
  quantity: string;
  /** Decimal string — landed cost per unit (unitCost + additionalCosts / totalAcceptedQty). */
  unitCost: string;
  /** Reference type, e.g. 'GOODS_RECEIPT'. */
  referenceType: string;
  /** Reference ID, e.g. goods receipt item ID. */
  referenceId: string;
}

/** One exact base-unit demand in an atomic logical Cart hold. */
export interface CartReservationDemand {
  variantId: string;
  /** Positive canonical decimal string with at most eight fractional digits. */
  quantity: string;
}

/** Shared trusted workflow metadata for Inventory-owned Cart reservation writes. */
export interface CartReservationOperationMetadata {
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  causationId: string;
  /** Trusted actor resolved by the calling application boundary. */
  actorId: string;
}

/** Create one all-or-nothing reservation for one logical Cart hold. */
export interface CreateCartReservationInput extends CartReservationOperationMetadata {
  organizationId: string;
  branchId: string;
  warehouseId: string;
  /** Stable Cart-owned hold workflow ID. */
  referenceId: string;
  /** Defaults to CART_HOLD; pending Sales may use PENDING_SALE. */
  referenceType?: 'CART_HOLD' | 'PENDING_SALE';
  /** Exact Cart aggregate version whose demands are being held. */
  cartVersion: number;
  demands: readonly CartReservationDemand[];
  /** TTL result already resolved and snapshotted by the Cart workflow when applicable. */
  expiresAt?: string;
}

/** Release a Cart hold without ever creating or extending a reservation. */
export interface ReleaseCartReservationInput extends CartReservationOperationMetadata {
  organizationId: string;
  branchId: string;
  warehouseId: string;
  referenceId: string;
  referenceType?: 'CART_HOLD' | 'PENDING_SALE';
  cartVersion: number;
}

/** Observe a Cart hold; a due ACTIVE hold is lazily expired in Inventory. */
export interface CheckCartReservationInput {
  organizationId: string;
  branchId: string;
  warehouseId: string;
  referenceId: string;
  referenceType?: 'CART_HOLD' | 'PENDING_SALE';
  cartVersion: number;
  correlationId: string;
  causationId: string;
  actorId: string;
}

export type CartReservationStatus = 'ACTIVE' | 'RELEASED' | 'EXPIRED' | 'CONSUMED';

/** Current exact balance view for one item of a logical reservation. */
export interface CartReservationItemSnapshot {
  stockPositionId: string;
  variantId: string;
  quantity: string;
  onHand: string;
  reserved: string;
  allocated: string;
  available: string;
}

/** Explicit inability to satisfy one aggregated base-unit demand. */
export interface CartReservationShortage {
  variantId: string;
  stockPositionId: string | null;
  requested: string;
  available: string;
  shortage: string;
}

/** ORM-free Inventory reservation boundary snapshot. */
export interface CartReservationSnapshot {
  reservationId: string;
  organizationId: string;
  branchId: string;
  warehouseId: string;
  referenceType: 'CART_HOLD' | 'PENDING_SALE';
  referenceId: string;
  cartVersion: number;
  status: CartReservationStatus;
  expiresAt: string | null;
  items: CartReservationItemSnapshot[];
}

/** Atomic create outcome. SHORTAGES is completed and has no stock side effects. */
export type CreateCartReservationResult =
  | {
      kind: 'ACTIVE';
      reservation: CartReservationSnapshot;
      shortages: [];
    }
  | {
      kind: 'SHORTAGES';
      reservation: null;
      organizationId: string;
      branchId: string;
      warehouseId: string;
      referenceId: string;
      cartVersion: number;
      expiresAt: string;
      shortages: CartReservationShortage[];
    };

/** Current state returned by release/check, including present availability. */
export interface CartReservationStateResult {
  kind: CartReservationStatus;
  reservation: CartReservationSnapshot;
  shortages: CartReservationShortage[];
}

/**
 * Commands and queries provided by the Inventory bounded context.
 */
export interface InventoryContracts {
  /**
   * Load the current availability for a single stock position.
   * Returns null when no stock position exists for the given triple.
   */
  getAvailability(
    organizationId: string,
    warehouseId: string,
    variantId: string,
  ): Promise<AvailabilityView | null>;

  /**
   * Receive stock into Inventory. Called by other bounded contexts (e.g.
   * Purchasing on goods receipt confirmation) through the contract — never
   * by directly mutating inventory tables.
   *
   * Creates or updates the stock position, creates a FIFO layer, and
   * appends a ledger entry. All within a single database transaction.
   *
   * @returns The ID of the stock position that received the stock.
   */
  receiveStock(input: ReceiveStockInput): Promise<{ stockPositionId: string }>;

  /** Atomically hold all aggregated Cart demands or return every shortage. */
  createCartReservation(input: CreateCartReservationInput): Promise<CreateCartReservationResult>;

  /** Convergently release/expire an existing Cart reservation. */
  releaseCartReservation(input: ReleaseCartReservationInput): Promise<CartReservationStateResult>;

  /** Check current state and lazily expire a due reservation. */
  checkCartReservation(input: CheckCartReservationInput): Promise<CartReservationStateResult>;

  /** Rebind an active reservation from Cart hold ownership to a pending Sale. */
  rebindReservationToSale(input: {
    organizationId: string;
    reservationId: string;
    saleReferenceId: string;
    cartVersion: number;
    warehouseId: string;
    branchId: string;
    idempotencyKey: string;
    requestHash: string;
    actorId: string;
    correlationId: string;
    causationId: string;
  }): Promise<{
    reservationId: string;
    status: 'ACTIVE';
    referenceType: 'PENDING_SALE';
    referenceId: string;
  }>;

  /** Release a reservation directly by ID for non-Cart owners such as Sales. */
  releaseReservationById(input: {
    organizationId: string;
    reservationId: string;
    idempotencyKey: string;
    requestHash: string;
    actorId: string;
  }): Promise<{ released: { id: string; status: string } }>;

  /** Consume a reservation directly by ID for trusted completion workflows. */
  consumeReservationById(input: {
    organizationId: string;
    reservationId: string;
    idempotencyKey: string;
    requestHash: string;
    actorId: string;
  }): Promise<{ consumed: { id: string; status: string } }>;
}

export interface InventoryMutationContracts {
  createCartReservationInTransaction(
    executor: DbExecutor,
    input: CreateCartReservationInput,
  ): Promise<CreateCartReservationResult>;
  rebindReservationToSaleInTransaction(
    executor: DbExecutor,
    input: {
      organizationId: string;
      reservationId: string;
      saleReferenceId: string;
      cartVersion: number;
      warehouseId: string;
      branchId: string;
      actorId: string;
      correlationId: string;
      causationId: string;
    },
  ): Promise<{
    reservationId: string;
    status: 'ACTIVE';
    referenceType: 'PENDING_SALE';
    referenceId: string;
  }>;
  releaseReservationByIdInTransaction(
    executor: DbExecutor,
    input: {
      organizationId: string;
      reservationId: string;
      actorId: string;
      correlationId: string;
    },
  ): Promise<{ released: { id: string; status: string } }>;
  consumeReservationByIdInTransaction(
    executor: DbExecutor,
    input: {
      organizationId: string;
      reservationId: string;
      actorId: string;
      correlationId: string;
    },
  ): Promise<{ consumed: { id: string; status: string } }>;
}
