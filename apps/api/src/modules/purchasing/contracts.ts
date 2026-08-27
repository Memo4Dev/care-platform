/**
 * Public module contract of the Purchasing bounded context
 * (docs/architecture/60-module-contracts.md "Purchasing").
 *
 * Other bounded contexts consume these queries through the
 * {@link PURCHASING_CONTRACTS} injection token — never through this module's
 * repositories or tables. The contract is read-only and every query
 * is organizationId-scoped (Layer 2 tenant isolation).
 */

/** Nest injection token binding the Purchasing context's contract provider. */
export const PURCHASING_CONTRACTS = Symbol('PURCHASING_CONTRACTS');

/** Supplier projection exposed to other contexts. */
export interface SupplierView {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  notes: string | null;
  version: number;
}

/**
 * Queries provided by the Purchasing bounded context.
 */
export interface PurchasingContracts {
  /**
   * Load a supplier by ID within an organization.
   * Returns null when no supplier exists.
   */
  getSupplier(
    organizationId: string,
    supplierId: string,
  ): Promise<SupplierView | null>;
}
