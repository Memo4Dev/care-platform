/**
 * Public module contract of the Inventory bounded context
 * (docs/architecture/60-module-contracts.md "Inventory").
 *
 * Other bounded contexts consume these queries through the
 * {@link INVENTORY_CONTRACTS} injection token — never through this module's
 * repositories or tables. The contract is read-only and every query
 * is organizationId-scoped (Layer 2 tenant isolation).
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
 * Queries provided by the Inventory bounded context.
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
}
