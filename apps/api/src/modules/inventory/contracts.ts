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
}
