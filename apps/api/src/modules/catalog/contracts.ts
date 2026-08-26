/**
 * Public module contract of the Catalog bounded context
 * (docs/architecture/60-module-contracts.md "Catalog").
 *
 * Other bounded contexts consume these queries through the
 * {@link CATALOG_CONTRACTS} injection token — never through this module's
 * repositories or tables. The contract is read-only and every query
 * is organizationId-scoped (Layer 2 tenant isolation).
 */

/** Nest injection token binding the Catalog context's contract provider. */
export const CATALOG_CONTRACTS = Symbol('CATALOG_CONTRACTS');

/** Product projection exposed to other contexts. */
export interface ProductView {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  status: 'ACTIVE' | 'DRAFT' | 'DISCONTINUED';
  version: number;
}

/** Variant projection exposed to other contexts. */
export interface VariantView {
  id: string;
  organizationId: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  baseUnitId: string;
  categoryId: string | null;
  status: 'ACTIVE' | 'DRAFT' | 'DISCONTINUED';
  version: number;
}

/** Barcode resolution view. */
export interface BarcodeView {
  id: string;
  organizationId: string;
  variantId: string;
  barcode: string;
  packagingDefinitionId: string | null;
  isActive: boolean;
}

/**
 * When a variant is sellable, this is the resolved view containing both
 * variant details and validation metadata.
 */
export interface SellableVariantView {
  variant: VariantView;
  productStatus: 'ACTIVE' | 'DRAFT' | 'DISCONTINUED';
}

/**
 * Queries provided by the Catalog bounded context.
 */
export interface CatalogContracts {
  /** Load a product by ID, scoped to organization. */
  getProduct(organizationId: string, productId: string): Promise<ProductView | null>;

  /** Load a variant by ID, scoped to organization. */
  getVariant(organizationId: string, variantId: string): Promise<VariantView | null>;

  /** Resolve a barcode string to its associated variant and packaging info. */
  resolveBarcode(organizationId: string, barcode: string): Promise<BarcodeView | null>;

  /**
   * Convert a quantity from one unit to another using the org's conversion
   * table. Returns the converted quantity as a numeric string.
   *
   * @throws PlatformError with INVALID_UNIT_CONVERSION when no path exists.
   */
  convertUnit(
    organizationId: string,
    fromUnitId: string,
    toUnitId: string,
    quantity: string,
  ): Promise<string>;

  /**
   * Validate that a variant is sellable (product is ACTIVE, variant is
   * ACTIVE). Returns the variant view with product status or throws
   * RESOURCE_NOT_FOUND when the variant does not exist.
   */
  validateSellableVariant(organizationId: string, variantId: string): Promise<SellableVariantView>;
}
