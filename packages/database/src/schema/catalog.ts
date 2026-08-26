import {
  boolean,
  decimal,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organization';
import { idColumn, optimisticVersion, timestamps } from './shared';

/**
 * Catalog bounded context (docs/architecture/12-catalog.md).
 *
 * Logical schema `catalog` (docs/architecture/30-persistence-overview.md):
 * products / product_variants / categories / unit_definitions /
 * unit_conversions / packaging_definitions / barcodes.
 *
 * Conventions:
 * - Every tenant-owned row carries `organization_id`.
 * - Business uniqueness is UNIQUE (organization_id, business_key).
 * - Composite tenant FKs anchor child rows to the owning organization.
 * - Variant has one Base Unit; Base Unit cannot change after inventory
 *   movement begins (enforced at application layer in M3).
 * - Barcode is optional and unique inside Organization when used.
 * - Unit conversions are versioned, not retroactively rewritten.
 */
export const catalogSchema = pgSchema('catalog');

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

export const PRODUCT_STATUSES = ['ACTIVE', 'DRAFT', 'DISCONTINUED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const productStatusEnum = catalogSchema.enum('product_status', PRODUCT_STATUSES);

/**
 * A sellable product within one organization.
 *
 * `name` is the display name. `sku` is an optional business-level stock
 * keeping unit at the product level (variants carry their own SKU).
 */
export const products = catalogSchema.table(
  'products',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    status: productStatusEnum('status').notNull().default('DRAFT'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('products_org_name_unique').on(table.organizationId, table.name),
    index('products_organization_id_idx').on(table.organizationId),
    index('products_status_idx').on(table.organizationId, table.status),
  ],
);

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Hierarchical category within one organization.
 *
 * `parentId` is NULL for top-level categories; otherwise it references
 * another category in the same organization (composite tenant FK).
 * `sortOrder` controls display ordering among siblings.
 */
export const categories = catalogSchema.table(
  'categories',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('categories_org_name_unique').on(table.organizationId, table.name),
    index('categories_organization_id_idx').on(table.organizationId),
    index('categories_parent_id_idx').on(table.parentId),
    // Composite self-reference FK: parent must be in same organization.
    foreignKey({
      name: 'categories_parent_tenant_fk',
      columns: [table.parentId, table.organizationId],
      foreignColumns: [table.id, table.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Unit Definitions                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Unit of measure defined within one organization.
 *
 * Each variant has one `baseUnitId`. Units support conversion chains
 * (e.g. Carton → Box → Piece). The `symbol` is a short display token.
 */
export const unitDefinitions = catalogSchema.table(
  'unit_definitions',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    symbol: text('symbol').notNull(),
    isBaseUnit: boolean('is_base_unit').notNull().default(false),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('unit_definitions_org_name_unique').on(table.organizationId, table.name),
    unique('unit_definitions_org_symbol_unique').on(table.organizationId, table.symbol),
    index('unit_definitions_organization_id_idx').on(table.organizationId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Unit Conversions                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Conversion factor between two units of the same organization.
 *
 * `fromUnitId → toUnitId` with `factor` such that:
 *   quantity_in_toUnit = quantity_in_fromUnit * factor
 *
 * Example: 1 Carton = 12 Boxes → fromUnit=Carton, toUnit=Box, factor=12.
 *
 * Conversions are append-only and versioned (docs/architecture/12-catalog.md:
 * "Conversion history must be versioned, not retroactively rewritten").
 */
export const unitConversions = catalogSchema.table(
  'unit_conversions',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    fromUnitId: uuid('from_unit_id').notNull(),
    toUnitId: uuid('to_unit_id').notNull(),
    factor: decimal('factor', { precision: 18, scale: 8 }).notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    unique('unit_conversions_org_from_to_unique').on(
      table.organizationId,
      table.fromUnitId,
      table.toUnitId,
    ),
    index('unit_conversions_organization_id_idx').on(table.organizationId),
    index('unit_conversions_from_unit_idx').on(table.fromUnitId),
    index('unit_conversions_to_unit_idx').on(table.toUnitId),
    foreignKey({
      name: 'unit_conversions_from_unit_tenant_fk',
      columns: [table.fromUnitId, table.organizationId],
      foreignColumns: [unitDefinitions.id, unitDefinitions.organizationId],
    }),
    foreignKey({
      name: 'unit_conversions_to_unit_tenant_fk',
      columns: [table.toUnitId, table.organizationId],
      foreignColumns: [unitDefinitions.id, unitDefinitions.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Packaging Definitions                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Packaging hierarchy definition within one organization.
 *
 * Defines how base units pack into larger containers, e.g.:
 *   Piece → Box (factor: 12) → Carton (factor: 6)
 *
 * `sortOrder` determines the hierarchy level (0 = smallest, 1 = next, etc.).
 */
export const packagingDefinitions = catalogSchema.table(
  'packaging_definitions',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    unitId: uuid('unit_id').notNull(),
    parentId: uuid('parent_id'),
    factor: decimal('factor', { precision: 18, scale: 8 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('packaging_definitions_org_name_unique').on(table.organizationId, table.name),
    index('packaging_definitions_organization_id_idx').on(table.organizationId),
    foreignKey({
      name: 'packaging_definitions_unit_tenant_fk',
      columns: [table.unitId, table.organizationId],
      foreignColumns: [unitDefinitions.id, unitDefinitions.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Product Variants                                                          */
/* -------------------------------------------------------------------------- */

export const VARIANT_STATUSES = ['ACTIVE', 'DRAFT', 'DISCONTINUED'] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export const variantStatusEnum = catalogSchema.enum('variant_status', VARIANT_STATUSES);

/**
 * A concrete sellable variant of a product (docs/architecture/12-catalog.md:
 * "Variant has stable identity").
 *
 * One product has many variants (e.g. size/color combos). Each variant
 * carries its own SKU, optional barcode, and base unit reference.
 *
 * `baseUnitId` cannot change after inventory movement begins (enforced
 * at application layer in M3).
 */
export const productVariants = catalogSchema.table(
  'product_variants',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    name: text('name').notNull(),
    sku: text('sku'),
    barcode: text('barcode'),
    baseUnitId: uuid('base_unit_id').notNull(),
    categoryId: uuid('category_id'),
    status: variantStatusEnum('status').notNull().default('DRAFT'),
    ...timestamps,
    version: optimisticVersion,
  },
  (table) => [
    unique('product_variants_org_sku_unique').on(table.organizationId, table.sku),
    unique('product_variants_org_barcode_unique').on(table.organizationId, table.barcode),
    index('product_variants_organization_id_idx').on(table.organizationId),
    index('product_variants_product_id_idx').on(table.productId),
    index('product_variants_category_id_idx').on(table.categoryId),
    foreignKey({
      name: 'product_variants_product_tenant_fk',
      columns: [table.productId, table.organizationId],
      foreignColumns: [products.id, products.organizationId],
    }),
    foreignKey({
      name: 'product_variants_unit_tenant_fk',
      columns: [table.baseUnitId, table.organizationId],
      foreignColumns: [unitDefinitions.id, unitDefinitions.organizationId],
    }),
    foreignKey({
      name: 'product_variants_category_tenant_fk',
      columns: [table.categoryId, table.organizationId],
      foreignColumns: [categories.id, categories.organizationId],
    }),
  ],
);

/* -------------------------------------------------------------------------- */
/* Barcodes (optional, standalone lookup)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Optional barcode metadata attached to a variant.
 *
 * A variant may have multiple barcodes (e.g. for different packaging
 * levels). Each barcode is unique within the organization when used.
 *
 * `packagingDefinitionId` identifies which packaging level this barcode
 * represents (nullable for base-unit barcodes).
 */
export const barcodes = catalogSchema.table(
  'barcodes',
  {
    id: idColumn(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').notNull(),
    barcode: text('barcode').notNull(),
    packagingDefinitionId: uuid('packaging_definition_id'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    unique('barcodes_org_barcode_unique').on(table.organizationId, table.barcode),
    index('barcodes_organization_id_idx').on(table.organizationId),
    index('barcodes_variant_id_idx').on(table.variantId),
    index('barcodes_barcode_idx').on(table.barcode),
    foreignKey({
      name: 'barcodes_variant_tenant_fk',
      columns: [table.variantId, table.organizationId],
      foreignColumns: [productVariants.id, productVariants.organizationId],
    }),
  ],
);
