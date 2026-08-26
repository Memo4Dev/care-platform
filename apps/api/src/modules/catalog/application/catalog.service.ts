import { newId, type DatabaseClient } from '@commerce-platform/database';
import { PlatformError } from '@commerce-platform/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../database/database.tokens';
import { Product } from '../domain/product';
import { Variant } from '../domain/variant';
import { Category } from '../domain/category';
import { UnitDefinition } from '../domain/unit';
import { PackagingDefinition } from '../domain/packaging';
import { Barcode } from '../domain/barcode';
import { CatalogRepository } from '../infrastructure/catalog.repository';

/**
 * Application service of the Catalog context: one method per domain
 * command, each executed inside a single database transaction that loads
 * the aggregate, applies the command and saves aggregate changes + domain
 * events (transactional outbox).
 *
 * Authentication, authorization and entitlement checks are intentionally NOT
 * part of this service; they live in the HTTP controller layer.
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(DATABASE) private readonly db: DatabaseClient,
    @Inject(CatalogRepository) private readonly repository: CatalogRepository,
  ) {}

  // ---------------------------------------------------------------------------
  // Product lifecycle
  // ---------------------------------------------------------------------------

  async createProduct(command: {
    organizationId: string;
    name: string;
    description?: string;
    productId?: string;
  }): Promise<CatalogCommandResult> {
    const productId = command.productId ?? newId();
    const aggregate = Product.create({
      id: productId,
      organizationId: command.organizationId,
      name: command.name,
      description: command.description,
    });

    return this.db.transaction(async (tx) => {
      const events = aggregate.pullDomainEvents();
      const eventsPersisted = await this.repository.saveProduct(tx, aggregate, events);
      return toProductResult(aggregate, eventsPersisted);
    });
  }

  async updateProduct(command: {
    organizationId: string;
    productId: string;
    name?: string;
    description?: string;
  }): Promise<CatalogCommandResult> {
    return this.executeProduct(command.organizationId, command.productId, (product) => {
      product.update({ name: command.name, description: command.description });
    });
  }

  async activateProduct(command: {
    organizationId: string;
    productId: string;
  }): Promise<CatalogCommandResult> {
    return this.executeProduct(command.organizationId, command.productId, (product) => {
      product.activate();
    });
  }

  async discontinueProduct(command: {
    organizationId: string;
    productId: string;
  }): Promise<CatalogCommandResult> {
    return this.executeProduct(command.organizationId, command.productId, (product) => {
      product.discontinue();
    });
  }

  // ---------------------------------------------------------------------------
  // Variants
  // ---------------------------------------------------------------------------

  async addVariant(command: {
    organizationId: string;
    productId: string;
    name: string;
    sku: string;
    barcode?: string | null;
    baseUnitId: string;
    categoryId?: string | null;
    variantId?: string;
  }): Promise<CatalogCommandResult> {
    return this.executeProduct(command.organizationId, command.productId, (product) => {
      const variant = Variant.create({
        id: command.variantId ?? newId(),
        organizationId: command.organizationId,
        productId: command.productId,
        name: command.name,
        sku: command.sku,
        barcode: command.barcode,
        baseUnitId: command.baseUnitId,
        categoryId: command.categoryId,
      });
      product.addVariant(variant);
    });
  }

  async updateVariant(command: {
    organizationId: string;
    productId: string;
    variantId: string;
    name?: string;
    sku?: string;
    barcode?: string | null;
    categoryId?: string | null;
  }): Promise<CatalogCommandResult> {
    return this.executeProduct(command.organizationId, command.productId, (product) => {
      const variant = product.getVariant(command.variantId);
      if (!variant) {
        throw PlatformError.notFound(
          `Variant ${command.variantId} was not found in product ${command.productId}.`,
          { details: { variantId: command.variantId, productId: command.productId } },
        );
      }
      variant.update({
        name: command.name,
        sku: command.sku,
        barcode: command.barcode,
        categoryId: command.categoryId,
      });
    });
  }

  async activateVariant(command: {
    organizationId: string;
    productId: string;
    variantId: string;
  }): Promise<CatalogCommandResult> {
    return this.executeProduct(command.organizationId, command.productId, (product) => {
      const variant = product.getVariant(command.variantId);
      if (!variant) {
        throw PlatformError.notFound(
          `Variant ${command.variantId} was not found in product ${command.productId}.`,
          { details: { variantId: command.variantId, productId: command.productId } },
        );
      }
      variant.activate();
    });
  }

  async discontinueVariant(command: {
    organizationId: string;
    productId: string;
    variantId: string;
  }): Promise<CatalogCommandResult> {
    return this.executeProduct(command.organizationId, command.productId, (product) => {
      const variant = product.getVariant(command.variantId);
      if (!variant) {
        throw PlatformError.notFound(
          `Variant ${command.variantId} was not found in product ${command.productId}.`,
          { details: { variantId: command.variantId, productId: command.productId } },
        );
      }
      variant.discontinue();
    });
  }

  // ---------------------------------------------------------------------------
  // Categories
  // ---------------------------------------------------------------------------

  async createCategory(command: {
    organizationId: string;
    name: string;
    description?: string;
    parentId?: string | null;
    sortOrder?: number;
    categoryId?: string;
  }): Promise<CategoryCommandResult> {
    const categoryId = command.categoryId ?? newId();
    const aggregate = Category.create({
      id: categoryId,
      organizationId: command.organizationId,
      parentId: command.parentId,
      name: command.name,
      description: command.description,
      sortOrder: command.sortOrder,
    });

    return this.db.transaction(async (tx) => {
      const events = aggregate.pullDomainEvents();
      const eventsPersisted = await this.repository.saveCategory(tx, aggregate, events);
      return toCategoryResult(aggregate, eventsPersisted);
    });
  }

  async updateCategory(command: {
    organizationId: string;
    categoryId: string;
    name?: string;
    description?: string;
    sortOrder?: number;
  }): Promise<CategoryCommandResult> {
    return this.executeCategory(command.organizationId, command.categoryId, (category) => {
      category.update({
        name: command.name,
        description: command.description,
        sortOrder: command.sortOrder,
      });
    });
  }

  async deactivateCategory(command: {
    organizationId: string;
    categoryId: string;
  }): Promise<CategoryCommandResult> {
    return this.executeCategory(command.organizationId, command.categoryId, (category) => {
      category.deactivate();
    });
  }

  // ---------------------------------------------------------------------------
  // Units
  // ---------------------------------------------------------------------------

  async createUnit(command: {
    organizationId: string;
    name: string;
    symbol: string;
    isBaseUnit?: boolean;
    unitId?: string;
  }): Promise<UnitCommandResult> {
    const unitId = command.unitId ?? newId();
    const aggregate = UnitDefinition.create({
      id: unitId,
      organizationId: command.organizationId,
      name: command.name,
      symbol: command.symbol,
      isBaseUnit: command.isBaseUnit,
    });

    return this.db.transaction(async (tx) => {
      const events = aggregate.pullDomainEvents();
      const eventsPersisted = await this.repository.saveUnit(tx, aggregate, events);
      return toUnitResult(aggregate, eventsPersisted);
    });
  }

  // ---------------------------------------------------------------------------
  // Unit conversions
  // ---------------------------------------------------------------------------

  async createConversion(command: {
    organizationId: string;
    fromUnitId: string;
    toUnitId: string;
    factor: string;
    conversionId?: string;
  }): Promise<{ conversionId: string; eventsPersisted: number }> {
    const conversionId = command.conversionId ?? newId();

    return this.db.transaction(async (tx) => {
      await this.repository.saveConversion(tx, {
        id: conversionId,
        organizationId: command.organizationId,
        fromUnitId: command.fromUnitId,
        toUnitId: command.toUnitId,
        factor: command.factor,
      });
      return { conversionId, eventsPersisted: 0 };
    });
  }

  // ---------------------------------------------------------------------------
  // Packaging
  // ---------------------------------------------------------------------------

  async createPackagingDefinition(command: {
    organizationId: string;
    name: string;
    unitId: string;
    parentId?: string | null;
    factor?: string;
    sortOrder?: number;
    packagingDefinitionId?: string;
  }): Promise<PackagingCommandResult> {
    const id = command.packagingDefinitionId ?? newId();
    const aggregate = PackagingDefinition.create({
      id,
      organizationId: command.organizationId,
      name: command.name,
      unitId: command.unitId,
      parentId: command.parentId,
      factor: command.factor,
      sortOrder: command.sortOrder,
    });

    return this.db.transaction(async (tx) => {
      const events = aggregate.pullDomainEvents();
      const eventsPersisted = await this.repository.savePackagingDefinition(tx, aggregate, events);
      return toPackagingResult(aggregate, eventsPersisted);
    });
  }

  // ---------------------------------------------------------------------------
  // Barcodes
  // ---------------------------------------------------------------------------

  async addBarcode(command: {
    organizationId: string;
    variantId: string;
    barcode: string;
    packagingDefinitionId?: string | null;
    barcodeId?: string;
  }): Promise<{ barcodeId: string; eventsPersisted: number }> {
    const barcodeId = command.barcodeId ?? newId();
    const barcode = Barcode.create({
      id: barcodeId,
      organizationId: command.organizationId,
      variantId: command.variantId,
      barcode: command.barcode,
      packagingDefinitionId: command.packagingDefinitionId,
    });

    return this.db.transaction(async (tx) => {
      await this.repository.saveBarcode(tx, barcode);
      return { barcodeId, eventsPersisted: 0 };
    });
  }

  async deactivateBarcode(command: {
    organizationId: string;
    barcodeId: string;
  }): Promise<{ deactivated: boolean }> {
    return this.db.transaction(async (tx) => {
      const deactivated = await this.repository.deactivateBarcode(
        tx,
        command.organizationId,
        command.barcodeId,
      );
      return { deactivated };
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async executeProduct(
    organizationId: string,
    productId: string,
    command: (product: Product) => void,
  ): Promise<CatalogCommandResult> {
    return this.db.transaction(async (tx) => {
      const product = await this.repository.findProduct(tx, organizationId, productId);
      if (!product) {
        throw PlatformError.notFound(`Product ${productId} was not found.`, {
          details: { productId, organizationId },
        });
      }
      command(product);
      const events = product.pullDomainEvents();
      const eventsPersisted = await this.repository.saveProduct(tx, product, events);
      return toProductResult(product, eventsPersisted);
    });
  }

  private async executeCategory(
    organizationId: string,
    categoryId: string,
    command: (category: Category) => void,
  ): Promise<CategoryCommandResult> {
    return this.db.transaction(async (tx) => {
      const category = await this.repository.findCategory(tx, organizationId, categoryId);
      if (!category) {
        throw PlatformError.notFound(`Category ${categoryId} was not found.`, {
          details: { categoryId, organizationId },
        });
      }
      command(category);
      const events = category.pullDomainEvents();
      const eventsPersisted = await this.repository.saveCategory(tx, category, events);
      return toCategoryResult(category, eventsPersisted);
    });
  }
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ProductSnapshot {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  status: 'ACTIVE' | 'DRAFT' | 'DISCONTINUED';
  version: number;
}

export interface CategorySnapshot {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  version: number;
}

export interface UnitSnapshot {
  id: string;
  organizationId: string;
  name: string;
  symbol: string;
  isBaseUnit: boolean;
  version: number;
}

export interface PackagingSnapshot {
  id: string;
  organizationId: string;
  name: string;
  unitId: string;
  parentId: string | null;
  factor: string;
  sortOrder: number;
  version: number;
}

export interface CatalogCommandResult {
  product: ProductSnapshot;
  eventsPersisted: number;
}

export interface CategoryCommandResult {
  category: CategorySnapshot;
  eventsPersisted: number;
}

export interface UnitCommandResult {
  unit: UnitSnapshot;
  eventsPersisted: number;
}

export interface PackagingCommandResult {
  packaging: PackagingSnapshot;
  eventsPersisted: number;
}

function toProductResult(product: Product, eventsPersisted: number): CatalogCommandResult {
  return {
    product: {
      id: product.id,
      organizationId: product.organizationId,
      name: product.name,
      description: product.description,
      status: product.status,
      version: product.version,
    },
    eventsPersisted,
  };
}

function toCategoryResult(category: Category, eventsPersisted: number): CategoryCommandResult {
  return {
    category: {
      id: category.id,
      organizationId: category.organizationId,
      name: category.name,
      description: category.description,
      parentId: category.parentId,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      version: category.version,
    },
    eventsPersisted,
  };
}

function toUnitResult(unit: UnitDefinition, eventsPersisted: number): UnitCommandResult {
  return {
    unit: {
      id: unit.id,
      organizationId: unit.organizationId,
      name: unit.name,
      symbol: unit.symbol,
      isBaseUnit: unit.isBaseUnit,
      version: unit.version,
    },
    eventsPersisted,
  };
}

function toPackagingResult(
  aggregate: PackagingDefinition,
  eventsPersisted: number,
): PackagingCommandResult {
  return {
    packaging: {
      id: aggregate.id,
      organizationId: aggregate.organizationId,
      name: aggregate.name,
      unitId: aggregate.unitId,
      parentId: aggregate.parentId,
      factor: aggregate.factor,
      sortOrder: aggregate.sortOrder,
      version: aggregate.version,
    },
    eventsPersisted,
  };
}
