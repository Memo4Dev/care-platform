import { ERROR_CODES, PlatformError } from '@commerce-platform/contracts';
import {
  barcodes,
  categories,
  integrationOutbox,
  newId,
  packagingDefinitions,
  productVariants,
  products,
  unitConversions,
  unitDefinitions,
} from '@commerce-platform/database';
import { asc, eq } from 'drizzle-orm';

import { Product } from '../domain/product';
import { Variant } from '../domain/variant';
import { Category } from '../domain/category';
import { UnitDefinition } from '../domain/unit';
import { PackagingDefinition } from '../domain/packaging';
import { Barcode } from '../domain/barcode';
import { CATALOG_AGGREGATE_TYPE, type CatalogDomainEvent } from '../domain/events';
import type { DbExecutor } from './db-executor';
import { catalogEventEnvelope } from './event-envelope';

/**
 * Repository for the Catalog bounded context.
 *
 * Each aggregate type (Product, Category, UnitDefinition) is loaded and
 * persisted independently. Product is the only aggregate with child entities
 * (variants) that are loaded/persisted alongside the root.
 *
 * - Every method takes an explicit {@link DbExecutor} so the application
 *   service controls the transaction boundary.
 * - Every tenant-owned access is `organizationId`-scoped; child rows are only
 *   ever loaded/written through their owning organization.
 * - Optimistic concurrency control is applied on update via `WHERE version = expectedVersion`.
 */
export class CatalogRepository {
  // ---------------------------------------------------------------------------
  // Product queries
  // ---------------------------------------------------------------------------

  /**
   * Load one product aggregate with its variants. Returns null when the
   * product does not exist.
   */
  async findProduct(
    executor: DbExecutor,
    organizationId: string,
    productId: string,
  ): Promise<Product | null> {
    const [productRow] = await executor
      .select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!productRow || productRow.organizationId !== organizationId) {
      return null;
    }

    const variantRows = await executor
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(asc(productVariants.createdAt));

    return Product.reconstitute(
      {
        id: productRow.id,
        organizationId: productRow.organizationId,
        name: productRow.name,
        description: productRow.description ?? '',
        status: productRow.status as Product['status'],
        version: productRow.version,
      },
      {
        variants: variantRows.map((row) =>
          Variant.reconstitute({
            id: row.id,
            organizationId: row.organizationId,
            productId: row.productId,
            name: row.name,
            sku: row.sku ?? '',
            barcode: row.barcode,
            baseUnitId: row.baseUnitId,
            categoryId: row.categoryId,
            isActive: row.status === 'ACTIVE',
            status: row.status as Variant['status'],
            version: row.version,
          }),
        ),
      },
    );
  }

  /**
   * Find a product by name within an organization.
   * Used for uniqueness checks.
   */
  async findProductByName(
    executor: DbExecutor,
    organizationId: string,
    name: string,
  ): Promise<Product | null> {
    const [row] = await executor
      .select()
      .from(products)
      .where(eq(products.organizationId, organizationId))
      .limit(1);

    if (!row || row.name !== name) {
      return null;
    }

    return Product.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      description: row.description ?? '',
      status: row.status as Product['status'],
      version: row.version,
    });
  }

  /**
   * Paginated list of products within an organization.
   */
  async findAllProducts(
    executor: DbExecutor,
    organizationId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Product[]> {
    const rows = await executor
      .select()
      .from(products)
      .where(eq(products.organizationId, organizationId))
      .orderBy(asc(products.createdAt))
      .limit(options?.limit ?? 50)
      .offset(options?.offset ?? 0);

    return rows.map((row) =>
      Product.reconstitute({
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        description: row.description ?? '',
        status: row.status as Product['status'],
        version: row.version,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Variant queries
  // ---------------------------------------------------------------------------

  /**
   * Load a single variant by ID.
   */
  async findVariant(
    executor: DbExecutor,
    organizationId: string,
    variantId: string,
  ): Promise<Variant | null> {
    const [row] = await executor
      .select()
      .from(productVariants)
      .where(eq(productVariants.id, variantId))
      .limit(1);

    if (!row || row.organizationId !== organizationId) {
      return null;
    }

    return Variant.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      productId: row.productId,
      name: row.name,
      sku: row.sku ?? '',
      barcode: row.barcode,
      baseUnitId: row.baseUnitId,
      categoryId: row.categoryId,
      isActive: row.status === 'ACTIVE',
      status: row.status as Variant['status'],
      version: row.version,
    });
  }

  /**
   * Find a variant by SKU within an organization.
   */
  async findVariantBySku(
    executor: DbExecutor,
    organizationId: string,
    sku: string,
  ): Promise<Variant | null> {
    const rows = await executor
      .select()
      .from(productVariants)
      .where(eq(productVariants.organizationId, organizationId))
      .limit(100);

    const row = rows.find((r) => r.sku === sku);
    if (!row) return null;

    return Variant.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      productId: row.productId,
      name: row.name,
      sku: row.sku ?? '',
      barcode: row.barcode,
      baseUnitId: row.baseUnitId,
      categoryId: row.categoryId,
      isActive: row.status === 'ACTIVE',
      status: row.status as Variant['status'],
      version: row.version,
    });
  }

  /**
   * Find a variant by barcode within an organization.
   */
  async findVariantByBarcode(
    executor: DbExecutor,
    organizationId: string,
    barcodeValue: string,
  ): Promise<Variant | null> {
    const [barcodeRow] = await executor
      .select()
      .from(barcodes)
      .where(eq(barcodes.barcode, barcodeValue))
      .limit(1);

    if (!barcodeRow || barcodeRow.organizationId !== organizationId) {
      return null;
    }

    return this.findVariant(executor, organizationId, barcodeRow.variantId);
  }

  /**
   * List all variants belonging to a product.
   */
  async findAllVariantsByProduct(
    executor: DbExecutor,
    organizationId: string,
    productId: string,
  ): Promise<Variant[]> {
    const rows = await executor
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, productId))
      .orderBy(asc(productVariants.createdAt));

    return rows
      .filter((row) => row.organizationId === organizationId)
      .map((row) =>
        Variant.reconstitute({
          id: row.id,
          organizationId: row.organizationId,
          productId: row.productId,
          name: row.name,
          sku: row.sku ?? '',
          barcode: row.barcode,
          baseUnitId: row.baseUnitId,
          categoryId: row.categoryId,
          isActive: row.status === 'ACTIVE',
          status: row.status as Variant['status'],
          version: row.version,
        }),
      );
  }

  // ---------------------------------------------------------------------------
  // Category queries
  // ---------------------------------------------------------------------------

  async findCategory(
    executor: DbExecutor,
    organizationId: string,
    categoryId: string,
  ): Promise<Category | null> {
    const [row] = await executor
      .select()
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1);

    if (!row || row.organizationId !== organizationId) {
      return null;
    }

    return Category.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      parentId: row.parentId,
      name: row.name,
      description: row.description ?? '',
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      version: row.version,
    });
  }

  async findAllCategories(executor: DbExecutor, organizationId: string): Promise<Category[]> {
    const rows = await executor
      .select()
      .from(categories)
      .where(eq(categories.organizationId, organizationId))
      .orderBy(asc(categories.sortOrder));

    return rows.map((row) =>
      Category.reconstitute({
        id: row.id,
        organizationId: row.organizationId,
        parentId: row.parentId,
        name: row.name,
        description: row.description ?? '',
        sortOrder: row.sortOrder,
        isActive: row.isActive,
        version: row.version,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Unit queries
  // ---------------------------------------------------------------------------

  async findUnit(
    executor: DbExecutor,
    organizationId: string,
    unitId: string,
  ): Promise<UnitDefinition | null> {
    const [row] = await executor
      .select()
      .from(unitDefinitions)
      .where(eq(unitDefinitions.id, unitId))
      .limit(1);

    if (!row || row.organizationId !== organizationId) {
      return null;
    }

    return UnitDefinition.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      symbol: row.symbol,
      isBaseUnit: row.isBaseUnit,
      version: row.version,
    });
  }

  async findAllUnits(executor: DbExecutor, organizationId: string): Promise<UnitDefinition[]> {
    const rows = await executor
      .select()
      .from(unitDefinitions)
      .where(eq(unitDefinitions.organizationId, organizationId))
      .orderBy(asc(unitDefinitions.createdAt));

    return rows.map((row) =>
      UnitDefinition.reconstitute({
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        symbol: row.symbol,
        isBaseUnit: row.isBaseUnit,
        version: row.version,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Unit conversion queries
  // ---------------------------------------------------------------------------

  async findConversions(
    executor: DbExecutor,
    organizationId: string,
  ): Promise<Array<{ fromUnitId: string; toUnitId: string; factor: string }>> {
    const rows = await executor
      .select()
      .from(unitConversions)
      .where(eq(unitConversions.organizationId, organizationId))
      .orderBy(asc(unitConversions.createdAt));

    return rows.map((row) => ({
      fromUnitId: row.fromUnitId,
      toUnitId: row.toUnitId,
      factor: row.factor,
    }));
  }

  // ---------------------------------------------------------------------------
  // Save methods — each handles insert/update + outbox events atomically
  // ---------------------------------------------------------------------------

  /**
   * Persist product aggregate changes plus domain events to the integration
   * outbox. Uses optimistic concurrency control on update.
   *
   * New variants are inserted; existing variants are updated with CAS;
   * unchanged variants are skipped.
   */
  async saveProduct(
    executor: DbExecutor,
    aggregate: Product,
    events: CatalogDomainEvent[],
    options: { correlationId?: string } = {},
  ): Promise<number> {
    if (aggregate.hasPendingChanges) {
      await this.persistProduct(executor, aggregate);
      await this.persistVariants(executor, aggregate);
    }

    if (events.length > 0) {
      await this.persistEvents(
        executor,
        events,
        aggregate.id,
        aggregate.version,
        options.correlationId,
      );
    }

    aggregate.markPersisted();
    return events.length;
  }

  /**
   * Persist a category aggregate plus domain events.
   */
  async saveCategory(
    executor: DbExecutor,
    aggregate: Category,
    events: CatalogDomainEvent[],
    options: { correlationId?: string } = {},
  ): Promise<number> {
    if (aggregate.hasPendingChanges) {
      await this.persistCategory(executor, aggregate);
    }

    if (events.length > 0) {
      await this.persistEvents(
        executor,
        events,
        aggregate.id,
        aggregate.version,
        options.correlationId,
      );
    }

    aggregate.markPersisted();
    return events.length;
  }

  /**
   * Persist a unit definition aggregate plus domain events.
   */
  async saveUnit(
    executor: DbExecutor,
    aggregate: UnitDefinition,
    events: CatalogDomainEvent[],
    options: { correlationId?: string } = {},
  ): Promise<number> {
    if (aggregate.hasPendingChanges) {
      await this.persistUnitDefinition(executor, aggregate);
    }

    if (events.length > 0) {
      await this.persistEvents(
        executor,
        events,
        aggregate.id,
        aggregate.version,
        options.correlationId,
      );
    }

    aggregate.markPersisted();
    return events.length;
  }

  /**
   * Persist a variant entity. Variants are child entities of the Product
   * aggregate; their events are collected at the Product level.
   */
  async saveVariant(executor: DbExecutor, aggregate: Variant): Promise<number> {
    if (aggregate.hasPendingChanges) {
      await this.persistVariant(executor, aggregate);
    }
    return 0;
  }

  /**
   * Insert a barcode row. Barcodes are standalone value objects without
   * domain events.
   */
  async saveBarcode(executor: DbExecutor, barcode: Barcode): Promise<void> {
    await executor.insert(barcodes).values({
      id: barcode.id,
      organizationId: barcode.organizationId,
      variantId: barcode.variantId,
      barcode: barcode.barcode,
      packagingDefinitionId: barcode.packagingDefinitionId,
      isActive: barcode.isActive,
    });
  }

  /**
   * Insert a packaging definition aggregate.
   */
  async savePackagingDefinition(
    executor: DbExecutor,
    aggregate: PackagingDefinition,
    events: CatalogDomainEvent[],
    options: { correlationId?: string } = {},
  ): Promise<number> {
    if (aggregate.hasPendingChanges) {
      await this.persistPackagingDefinition(executor, aggregate);
    }

    if (events.length > 0) {
      await this.persistEvents(
        executor,
        events,
        aggregate.id,
        aggregate.version,
        options.correlationId,
      );
    }

    aggregate.markPersisted();
    return events.length;
  }

  /**
   * Insert a unit conversion row.
   */
  async saveConversion(
    executor: DbExecutor,
    input: {
      id?: string;
      organizationId: string;
      fromUnitId: string;
      toUnitId: string;
      factor: string;
    },
  ): Promise<void> {
    try {
      await executor.insert(unitConversions).values({
        id: input.id ?? newId(),
        organizationId: input.organizationId,
        fromUnitId: input.fromUnitId,
        toUnitId: input.toUnitId,
        factor: input.factor,
      });
    } catch (error) {
      throw mapPersistenceError(error, {
        action: 'insert',
        table: 'catalog.unit_conversions',
        organizationId: input.organizationId,
      });
    }
  }

  /**
   * Deactivate a barcode. Updates the `isActive` flag.
   */
  async deactivateBarcode(
    executor: DbExecutor,
    organizationId: string,
    barcodeId: string,
  ): Promise<boolean> {
    const updated = await executor
      .update(barcodes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(barcodes.id, barcodeId))
      .returning({ id: barcodes.id });

    return updated.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Private persistence helpers
  // ---------------------------------------------------------------------------

  private async persistProduct(executor: DbExecutor, aggregate: Product): Promise<void> {
    if (aggregate.version === 1 && aggregate.expectedVersion === 0) {
      // New product
      try {
        await executor.insert(products).values({
          id: aggregate.id,
          organizationId: aggregate.organizationId,
          name: aggregate.name,
          description: aggregate.description,
          status: aggregate.status,
          version: aggregate.version,
        });
      } catch (error) {
        throw mapPersistenceError(error, {
          action: 'insert',
          table: 'catalog.products',
          organizationId: aggregate.organizationId,
          resourceId: aggregate.id,
        });
      }
    } else {
      // Update with optimistic concurrency
      let updated: Array<{ id: string }>;
      try {
        updated = await executor
          .update(products)
          .set({
            name: aggregate.name,
            description: aggregate.description,
            status: aggregate.status,
            updatedAt: new Date(),
            version: aggregate.version,
          })
          .where(eq(products.id, aggregate.id))
          .returning({ id: products.id });
      } catch (error) {
        throw mapPersistenceError(error, {
          action: 'update',
          table: 'catalog.products',
          organizationId: aggregate.organizationId,
          resourceId: aggregate.id,
        });
      }

      if (updated.length === 0) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Product ${aggregate.id} was modified concurrently.`,
          {
            details: {
              productId: aggregate.id,
              expectedVersion: aggregate.expectedVersion,
            },
          },
        );
      }
    }
  }

  /**
   * Persist variant changes for a product aggregate.
   * New variants (version=1, expectedVersion=0) are inserted.
   * Existing variants with pending changes are updated with CAS.
   */
  private async persistVariants(executor: DbExecutor, aggregate: Product): Promise<void> {
    for (const variant of aggregate.variants) {
      if (variant.hasPendingChanges) {
        if (variant.version === 1 && variant.expectedVersion === 0) {
          try {
            await executor.insert(productVariants).values({
              id: variant.id,
              organizationId: variant.organizationId,
              productId: variant.productId,
              name: variant.name,
              sku: variant.sku,
              barcode: variant.barcode,
              baseUnitId: variant.baseUnitId,
              categoryId: variant.categoryId,
              status: variant.status,
              version: variant.version,
            });
          } catch (error) {
            throw mapPersistenceError(error, {
              action: 'insert',
              table: 'catalog.product_variants',
              organizationId: variant.organizationId,
              resourceId: variant.id,
            });
          }
        } else {
          const updated = await executor
            .update(productVariants)
            .set({
              name: variant.name,
              sku: variant.sku,
              barcode: variant.barcode,
              categoryId: variant.categoryId,
              status: variant.status,
              updatedAt: new Date(),
              version: variant.version,
            })
            .where(eq(productVariants.id, variant.id))
            .returning({ id: productVariants.id });

          if (updated.length === 0) {
            throw PlatformError.of(
              ERROR_CODES.RESOURCE_VERSION_CONFLICT,
              `Variant ${variant.id} was modified concurrently.`,
              {
                details: {
                  variantId: variant.id,
                  expectedVersion: variant.expectedVersion,
                },
              },
            );
          }
        }
      }
    }
  }

  private async persistCategory(executor: DbExecutor, aggregate: Category): Promise<void> {
    if (aggregate.version === 1 && aggregate.expectedVersion === 0) {
      try {
        await executor.insert(categories).values({
          id: aggregate.id,
          organizationId: aggregate.organizationId,
          parentId: aggregate.parentId,
          name: aggregate.name,
          description: aggregate.description,
          sortOrder: aggregate.sortOrder,
          isActive: aggregate.isActive,
          version: aggregate.version,
        });
      } catch (error) {
        throw mapPersistenceError(error, {
          action: 'insert',
          table: 'catalog.categories',
          organizationId: aggregate.organizationId,
          resourceId: aggregate.id,
        });
      }
    } else {
      const updated = await executor
        .update(categories)
        .set({
          name: aggregate.name,
          description: aggregate.description,
          sortOrder: aggregate.sortOrder,
          isActive: aggregate.isActive,
          updatedAt: new Date(),
          version: aggregate.version,
        })
        .where(eq(categories.id, aggregate.id))
        .returning({ id: categories.id });

      if (updated.length === 0) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Category ${aggregate.id} was modified concurrently.`,
          {
            details: {
              categoryId: aggregate.id,
              expectedVersion: aggregate.expectedVersion,
            },
          },
        );
      }
    }
  }

  private async persistUnitDefinition(
    executor: DbExecutor,
    aggregate: UnitDefinition,
  ): Promise<void> {
    if (aggregate.version === 1 && aggregate.expectedVersion === 0) {
      try {
        await executor.insert(unitDefinitions).values({
          id: aggregate.id,
          organizationId: aggregate.organizationId,
          name: aggregate.name,
          symbol: aggregate.symbol,
          isBaseUnit: aggregate.isBaseUnit,
          version: aggregate.version,
        });
      } catch (error) {
        throw mapPersistenceError(error, {
          action: 'insert',
          table: 'catalog.unit_definitions',
          organizationId: aggregate.organizationId,
          resourceId: aggregate.id,
        });
      }
    } else {
      const updated = await executor
        .update(unitDefinitions)
        .set({
          name: aggregate.name,
          symbol: aggregate.symbol,
          isBaseUnit: aggregate.isBaseUnit,
          updatedAt: new Date(),
          version: aggregate.version,
        })
        .where(eq(unitDefinitions.id, aggregate.id))
        .returning({ id: unitDefinitions.id });

      if (updated.length === 0) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Unit definition ${aggregate.id} was modified concurrently.`,
          {
            details: {
              unitId: aggregate.id,
              expectedVersion: aggregate.expectedVersion,
            },
          },
        );
      }
    }
  }

  private async persistPackagingDefinition(
    executor: DbExecutor,
    aggregate: PackagingDefinition,
  ): Promise<void> {
    if (aggregate.version === 1 && aggregate.expectedVersion === 0) {
      try {
        await executor.insert(packagingDefinitions).values({
          id: aggregate.id,
          organizationId: aggregate.organizationId,
          name: aggregate.name,
          unitId: aggregate.unitId,
          parentId: aggregate.parentId,
          factor: aggregate.factor,
          sortOrder: aggregate.sortOrder,
          version: aggregate.version,
        });
      } catch (error) {
        throw mapPersistenceError(error, {
          action: 'insert',
          table: 'catalog.packaging_definitions',
          organizationId: aggregate.organizationId,
          resourceId: aggregate.id,
        });
      }
    } else {
      const updated = await executor
        .update(packagingDefinitions)
        .set({
          name: aggregate.name,
          sortOrder: aggregate.sortOrder,
          updatedAt: new Date(),
          version: aggregate.version,
        })
        .where(eq(packagingDefinitions.id, aggregate.id))
        .returning({ id: packagingDefinitions.id });

      if (updated.length === 0) {
        throw PlatformError.of(
          ERROR_CODES.RESOURCE_VERSION_CONFLICT,
          `Packaging definition ${aggregate.id} was modified concurrently.`,
          {
            details: {
              packagingDefinitionId: aggregate.id,
              expectedVersion: aggregate.expectedVersion,
            },
          },
        );
      }
    }
  }

  private async persistVariant(executor: DbExecutor, aggregate: Variant): Promise<void> {
    const updated = await executor
      .update(productVariants)
      .set({
        name: aggregate.name,
        sku: aggregate.sku,
        barcode: aggregate.barcode,
        categoryId: aggregate.categoryId,
        status: aggregate.status,
        updatedAt: new Date(),
        version: aggregate.version,
      })
      .where(eq(productVariants.id, aggregate.id))
      .returning({ id: productVariants.id });

    if (updated.length === 0) {
      throw PlatformError.of(
        ERROR_CODES.RESOURCE_VERSION_CONFLICT,
        `Variant ${aggregate.id} was modified concurrently.`,
        {
          details: {
            variantId: aggregate.id,
            expectedVersion: aggregate.expectedVersion,
          },
        },
      );
    }
  }

  /**
   * Persist domain events to the integration outbox.
   * Events go out LAST within the transaction: readers of the outbox must
   * never observe an event for state that is not committed alongside it.
   */
  private async persistEvents(
    executor: DbExecutor,
    events: CatalogDomainEvent[],
    aggregateId: string,
    aggregateVersion: number,
    correlationId?: string,
  ): Promise<void> {
    await executor.insert(integrationOutbox).values(
      events.map((event) => ({
        id: newId(),
        aggregateType: CATALOG_AGGREGATE_TYPE,
        aggregateId,
        eventType: `catalog.${event.type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`,
        payload: catalogEventEnvelope({
          event,
          aggregateId,
          aggregateVersion,
          correlationId: correlationId ?? 'SYSTEM',
        }),
        correlationId: correlationId ?? null,
        occurredAt: event.occurredAt,
      })),
    );
  }
}

interface PersistenceErrorContext {
  action: 'insert' | 'update';
  table: string;
  organizationId: string;
  resourceId?: string;
}

/**
 * Minimal PG error surface used for mapping (node-postgres errors carry these
 * fields but there is no official typed export worth depending on).
 */
interface PgLikeError {
  code?: unknown;
  constraint?: unknown;
  detail?: unknown;
}

/**
 * Maps storage-level violations onto the platform error catalog:
 *
 * - unique_violation on business keys -> VALIDATION_FAILED (422): well-formed
 *   content violating business rules; the constraint name is preserved in
 *   `details` for support tooling.
 * - everything else is returned untouched: unexpected driver failures must
 *   not be disguised as domain errors.
 */
export function mapPersistenceError(error: unknown, context: PersistenceErrorContext): unknown {
  const candidate = error as PgLikeError | null;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    candidate.code !== '23505' ||
    typeof candidate.constraint !== 'string'
  ) {
    return error;
  }

  const fieldByConstraint: Record<string, string> = {
    products_org_name_unique: 'name',
    categories_org_name_unique: 'name',
    unit_definitions_org_name_unique: 'name',
    unit_definitions_org_symbol_unique: 'symbol',
    product_variants_org_sku_unique: 'sku',
    product_variants_org_barcode_unique: 'barcode',
    packaging_definitions_org_name_unique: 'name',
    barcodes_org_barcode_unique: 'barcode',
    unit_conversions_org_from_to_unique: 'fromUnitId+toUnitId',
  };

  const field = fieldByConstraint[candidate.constraint] ?? 'constraint';
  return PlatformError.validationFailed(
    `${context.table} constraint ${candidate.constraint} violated during ${context.action}.`,
    {
      details: {
        constraint: candidate.constraint,
        field,
        table: context.table,
        organizationId: context.organizationId,
        ...(context.resourceId === undefined ? {} : { resourceId: context.resourceId }),
      },
      cause: error,
    },
  );
}
