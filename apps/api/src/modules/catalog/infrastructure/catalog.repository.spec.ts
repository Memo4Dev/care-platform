import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlatformError } from '@commerce-platform/contracts';

import { CatalogRepository, mapPersistenceError } from './catalog.repository';
import { Product } from '../domain/product';
import { Category } from '../domain/category';
import { UnitDefinition } from '../domain/unit';
import { Barcode } from '../domain/barcode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock Drizzle executor that supports the fluent query API.
 * Every method returns the chain object, except `limit` which by default
 * also returns the chain (tests override it to return terminal results).
 */
function mockExecutor() {
  const chains: Record<string, ReturnType<typeof vi.fn>> = {};
  chains.from = vi.fn().mockReturnValue(chains);
  chains.where = vi.fn().mockReturnValue(chains);
  chains.limit = vi.fn().mockReturnValue(chains);
  chains.orderBy = vi.fn().mockReturnValue(chains);
  chains.offset = vi.fn().mockReturnValue(chains);
  chains.set = vi.fn().mockReturnValue(chains);
  chains.values = vi.fn().mockReturnValue(chains);
  chains.returning = vi.fn().mockReturnValue([]);
  chains.and = vi.fn().mockReturnValue(chains);

  const executor = {
    select: vi.fn().mockReturnValue(chains),
    insert: vi.fn().mockReturnValue(chains),
    update: vi.fn().mockReturnValue(chains),
  };

  return { executor, chains };
}

/**
 * Override the chain so that select().from().where().limit() returns rows
 * as an array (terminal query result). Handles both `.limit(N)` (returns
 * array) and `.limit(N).offset(M)` (returns array) patterns.
 */
function chainReturnsRows(
  chains: ReturnType<typeof mockExecutor>['chains'],
  rows: Record<string, unknown>[],
) {
  // .limit(N) returns an object that acts as both array-like and has .offset()
  const result = Object.assign([...rows], {
    offset: vi.fn().mockReturnValue([...rows]),
  });
  chains.limit = vi.fn().mockReturnValue(result);
}

const ORG_ID = '01900000-0000-7000-8000-000000000001';
const PRODUCT_ID = '01900000-0000-7000-8000-000000000010';
const VARIANT_ID = '01900000-0000-7000-8000-000000000020';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CatalogRepository', () => {
  let repo: CatalogRepository;

  beforeEach(() => {
    repo = new CatalogRepository();
  });

  // =========================================================================
  // findProduct
  // =========================================================================

  describe('findProduct', () => {
    it('returns null when product does not exist', async () => {
      const { executor, chains } = mockExecutor();
      chainReturnsRows(chains, []);

      const result = await repo.findProduct(executor, ORG_ID, PRODUCT_ID);
      expect(result).toBeNull();
    });

    it('returns null when product belongs to a different organization', async () => {
      const { executor, chains } = mockExecutor();
      let callCount = 0;
      chains.limit = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return [
            {
              id: PRODUCT_ID,
              organizationId: 'other-org',
              name: 'Test Product',
              description: null,
              status: 'DRAFT',
              version: 1,
            },
          ];
        }
        return [];
      });

      const result = await repo.findProduct(executor, ORG_ID, PRODUCT_ID);
      expect(result).toBeNull();
    });

    it('returns a reconstituted product with variants', async () => {
      const { executor, chains } = mockExecutor();

      // Product query: select().from().where().limit(1) — limit is terminal
      const productRow = [
        {
          id: PRODUCT_ID,
          organizationId: ORG_ID,
          name: 'Test Product',
          description: 'A product',
          status: 'DRAFT',
          version: 1,
        },
      ];
      // Variants query: select().from().where().orderBy() — orderBy is terminal
      const variantRows = [
        {
          id: VARIANT_ID,
          organizationId: ORG_ID,
          productId: PRODUCT_ID,
          name: 'Variant 1',
          sku: 'SKU-1',
          barcode: null,
          baseUnitId: 'unit-1',
          categoryId: null,
          status: 'ACTIVE',
          version: 1,
        },
      ];

      chains.limit = vi.fn().mockImplementation(() => {
        return productRow;
      });
      chains.orderBy = vi.fn().mockImplementation(() => {
        // First orderBy = product query doesn't exist (product uses limit)
        // Second call = variants query
        return variantRows;
      });

      const product = await repo.findProduct(executor, ORG_ID, PRODUCT_ID);

      expect(product).not.toBeNull();
      expect(product!.id).toBe(PRODUCT_ID);
      expect(product!.name).toBe('Test Product');
      expect(product!.status).toBe('DRAFT');
      expect(product!.variants).toHaveLength(1);
      expect(product!.variants[0].sku).toBe('SKU-1');
    });
  });

  // =========================================================================
  // findVariant
  // =========================================================================

  describe('findVariant', () => {
    it('returns null when variant does not exist', async () => {
      const { executor, chains } = mockExecutor();
      chainReturnsRows(chains, []);

      const result = await repo.findVariant(executor, ORG_ID, VARIANT_ID);
      expect(result).toBeNull();
    });

    it('returns null when variant belongs to different organization', async () => {
      const { executor, chains } = mockExecutor();
      chainReturnsRows(chains, [
        {
          id: VARIANT_ID,
          organizationId: 'other-org',
          productId: PRODUCT_ID,
          name: 'Variant',
          sku: 'SKU',
          barcode: null,
          baseUnitId: 'unit-1',
          categoryId: null,
          status: 'DRAFT',
          version: 1,
        },
      ]);

      const result = await repo.findVariant(executor, ORG_ID, VARIANT_ID);
      expect(result).toBeNull();
    });

    it('returns a reconstituted variant', async () => {
      const { executor, chains } = mockExecutor();
      chainReturnsRows(chains, [
        {
          id: VARIANT_ID,
          organizationId: ORG_ID,
          productId: PRODUCT_ID,
          name: 'Variant 1',
          sku: 'SKU-1',
          barcode: '123456',
          baseUnitId: 'unit-1',
          categoryId: 'cat-1',
          status: 'ACTIVE',
          version: 1,
        },
      ]);

      const variant = await repo.findVariant(executor, ORG_ID, VARIANT_ID);
      expect(variant).not.toBeNull();
      expect(variant!.id).toBe(VARIANT_ID);
      expect(variant!.sku).toBe('SKU-1');
      expect(variant!.barcode).toBe('123456');
      expect(variant!.status).toBe('ACTIVE');
    });
  });

  // =========================================================================
  // findCategory
  // =========================================================================

  describe('findCategory', () => {
    it('returns null when category does not exist', async () => {
      const { executor, chains } = mockExecutor();
      chainReturnsRows(chains, []);

      const result = await repo.findCategory(executor, ORG_ID, 'cat-1');
      expect(result).toBeNull();
    });

    it('returns a reconstituted category', async () => {
      const { executor, chains } = mockExecutor();
      chainReturnsRows(chains, [
        {
          id: 'cat-1',
          organizationId: ORG_ID,
          parentId: null,
          name: 'Electronics',
          description: 'All electronics',
          sortOrder: 0,
          isActive: true,
          version: 1,
        },
      ]);

      const category = await repo.findCategory(executor, ORG_ID, 'cat-1');
      expect(category).not.toBeNull();
      expect(category!.name).toBe('Electronics');
      expect(category!.isActive).toBe(true);
    });
  });

  // =========================================================================
  // findAllProducts
  // =========================================================================

  describe('findAllProducts', () => {
    it('returns paginated products', async () => {
      const { executor, chains } = mockExecutor();
      chainReturnsRows(chains, [
        {
          id: PRODUCT_ID,
          organizationId: ORG_ID,
          name: 'Product 1',
          description: null,
          status: 'ACTIVE',
          version: 1,
        },
      ]);

      const prods = await repo.findAllProducts(executor, ORG_ID, { limit: 10, offset: 0 });
      expect(prods).toHaveLength(1);
      expect(prods[0].name).toBe('Product 1');
    });

    it('returns empty array when no products', async () => {
      const { executor, chains } = mockExecutor();
      chainReturnsRows(chains, []);

      const prods = await repo.findAllProducts(executor, ORG_ID);
      expect(prods).toHaveLength(0);
    });
  });

  // =========================================================================
  // findAllCategories
  // =========================================================================

  describe('findAllCategories', () => {
    it('returns categories scoped to organization', async () => {
      const { executor, chains } = mockExecutor();
      const rows = [
        {
          id: 'cat-1',
          organizationId: ORG_ID,
          parentId: null,
          name: 'Category A',
          description: null,
          sortOrder: 0,
          isActive: true,
          version: 1,
        },
      ];
      // findAllCategories: select().from().where().orderBy()
      // orderBy is terminal
      chains.orderBy = vi.fn().mockReturnValue([...rows]);

      const cats = await repo.findAllCategories(executor, ORG_ID);
      expect(cats).toHaveLength(1);
      expect(cats[0].name).toBe('Category A');
    });
  });

  // =========================================================================
  // findAllUnits
  // =========================================================================

  describe('findAllUnits', () => {
    it('returns units scoped to organization', async () => {
      const { executor, chains } = mockExecutor();
      // findAllUnits: select().from().where().orderBy() — orderBy is terminal
      chains.orderBy = vi.fn().mockReturnValue([
        {
          id: 'unit-1',
          organizationId: ORG_ID,
          name: 'Piece',
          symbol: 'pc',
          isBaseUnit: true,
          version: 1,
        },
      ]);

      const units = await repo.findAllUnits(executor, ORG_ID);
      expect(units).toHaveLength(1);
      expect(units[0].name).toBe('Piece');
    });
  });

  // =========================================================================
  // findConversions
  // =========================================================================

  describe('findConversions', () => {
    it('returns all conversions for an organization', async () => {
      const { executor, chains } = mockExecutor();
      // findConversions: select().from().where().orderBy() — orderBy is terminal
      chains.orderBy = vi.fn().mockReturnValue([
        { fromUnitId: 'u1', toUnitId: 'u2', factor: '12' },
        { fromUnitId: 'u2', toUnitId: 'u3', factor: '6' },
      ]);

      const conversions = await repo.findConversions(executor, ORG_ID);
      expect(conversions).toHaveLength(2);
      expect(conversions[0].factor).toBe('12');
    });
  });

  // =========================================================================
  // saveProduct
  // =========================================================================

  describe('saveProduct', () => {
    it('inserts a new product and persists events', async () => {
      const { executor, chains } = mockExecutor();
      chains.returning = vi.fn().mockReturnValue([{ id: PRODUCT_ID }]);

      const product = Product.create({
        id: PRODUCT_ID,
        organizationId: ORG_ID,
        name: 'New Product',
      });
      const events = product.pullDomainEvents();

      const count = await repo.saveProduct(executor, product, events);

      expect(count).toBe(1);
      expect(executor.insert).toHaveBeenCalled();
    });

    it('returns 0 when aggregate has no pending changes and no events', async () => {
      const { executor } = mockExecutor();

      const product = Product.reconstitute({
        id: PRODUCT_ID,
        organizationId: ORG_ID,
        name: 'Existing',
        description: '',
        status: 'DRAFT',
        version: 1,
      });

      const count = await repo.saveProduct(executor, product, []);
      expect(count).toBe(0);
    });

    it('updates an existing product with version bump', async () => {
      const { executor, chains } = mockExecutor();
      chains.returning = vi.fn().mockReturnValue([{ id: PRODUCT_ID }]);

      const product = Product.reconstitute({
        id: PRODUCT_ID,
        organizationId: ORG_ID,
        name: 'Existing',
        description: '',
        status: 'DRAFT',
        version: 1,
      });
      product.update({ name: 'Updated' });
      const events = product.pullDomainEvents();

      const count = await repo.saveProduct(executor, product, events);

      expect(count).toBe(1);
      expect(executor.update).toHaveBeenCalled();
    });

    it('throws RESOURCE_VERSION_CONFLICT on zero-row update', async () => {
      const { executor, chains } = mockExecutor();
      chains.returning = vi.fn().mockReturnValue([]);

      const product = Product.reconstitute({
        id: PRODUCT_ID,
        organizationId: ORG_ID,
        name: 'Existing',
        description: '',
        status: 'DRAFT',
        version: 2,
      });
      product.update({ name: 'Conflict' });
      product.pullDomainEvents();

      await expect(repo.saveProduct(executor, product, [])).rejects.toThrow();
    });
  });

  // =========================================================================
  // saveCategory
  // =========================================================================

  describe('saveCategory', () => {
    it('inserts a new category', async () => {
      const { executor, chains } = mockExecutor();
      chains.returning = vi.fn().mockReturnValue([{ id: 'cat-1' }]);

      const category = Category.create({
        id: 'cat-1',
        organizationId: ORG_ID,
        name: 'New Category',
      });
      const events = category.pullDomainEvents();

      const count = await repo.saveCategory(executor, category, events);
      expect(count).toBe(1);
      expect(executor.insert).toHaveBeenCalled();
    });

    it('updates an existing category', async () => {
      const { executor, chains } = mockExecutor();
      chains.returning = vi.fn().mockReturnValue([{ id: 'cat-1' }]);

      const category = Category.reconstitute({
        id: 'cat-1',
        organizationId: ORG_ID,
        parentId: null,
        name: 'Old',
        description: '',
        sortOrder: 0,
        isActive: true,
        version: 1,
      });
      category.update({ name: 'New Name' });
      const events = category.pullDomainEvents();

      const count = await repo.saveCategory(executor, category, events);
      expect(count).toBe(1);
      expect(executor.update).toHaveBeenCalled();
    });

    it('throws on concurrent version conflict', async () => {
      const { executor, chains } = mockExecutor();
      chains.returning = vi.fn().mockReturnValue([]);

      const category = Category.reconstitute({
        id: 'cat-1',
        organizationId: ORG_ID,
        parentId: null,
        name: 'Old',
        description: '',
        sortOrder: 0,
        isActive: true,
        version: 2,
      });
      category.update({ name: 'Conflict' });
      category.pullDomainEvents();

      await expect(repo.saveCategory(executor, category, [])).rejects.toThrow();
    });
  });

  // =========================================================================
  // saveUnit
  // =========================================================================

  describe('saveUnit', () => {
    it('inserts a new unit definition', async () => {
      const { executor, chains } = mockExecutor();
      chains.returning = vi.fn().mockReturnValue([{ id: 'unit-1' }]);

      const unit = UnitDefinition.create({
        id: 'unit-1',
        organizationId: ORG_ID,
        name: 'Piece',
        symbol: 'pc',
      });
      const events = unit.pullDomainEvents();

      const count = await repo.saveUnit(executor, unit, events);
      expect(count).toBe(1);
      expect(executor.insert).toHaveBeenCalled();
    });

    it('returns 0 events when unit has no pending changes', async () => {
      const { executor } = mockExecutor();

      const unit = UnitDefinition.reconstitute({
        id: 'unit-1',
        organizationId: ORG_ID,
        name: 'Piece',
        symbol: 'pc',
        isBaseUnit: false,
        version: 1,
      });

      const count = await repo.saveUnit(executor, unit, []);
      expect(count).toBe(0);
      expect(executor.insert).not.toHaveBeenCalled();
      expect(executor.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // saveConversion
  // =========================================================================

  describe('saveConversion', () => {
    it('inserts a unit conversion', async () => {
      const { executor } = mockExecutor();

      await repo.saveConversion(executor, {
        organizationId: ORG_ID,
        fromUnitId: 'unit-from',
        toUnitId: 'unit-to',
        factor: '12',
      });

      expect(executor.insert).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // saveBarcode
  // =========================================================================

  describe('saveBarcode', () => {
    it('inserts a barcode', async () => {
      const { executor } = mockExecutor();
      const barcode = Barcode.create({
        id: 'barcode-1',
        organizationId: ORG_ID,
        variantId: VARIANT_ID,
        barcode: '123456789',
      });

      await repo.saveBarcode(executor, barcode);
      expect(executor.insert).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // deactivateBarcode
  // =========================================================================

  describe('deactivateBarcode', () => {
    it('returns true when barcode was deactivated', async () => {
      const { executor, chains } = mockExecutor();
      chains.returning = vi.fn().mockReturnValue([{ id: 'barcode-1' }]);

      const result = await repo.deactivateBarcode(executor, ORG_ID, 'barcode-1');
      expect(result).toBe(true);
      expect(executor.update).toHaveBeenCalled();
    });

    it('returns false when barcode was not found', async () => {
      const { executor, chains } = mockExecutor();
      chains.returning = vi.fn().mockReturnValue([]);

      const result = await repo.deactivateBarcode(executor, ORG_ID, 'nonexistent');
      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // savePackagingDefinition
  // =========================================================================

  describe('savePackagingDefinition', () => {
    it('inserts a new packaging definition', async () => {
      const { executor, chains } = mockExecutor();
      chains.returning = vi.fn().mockReturnValue([{ id: 'pkg-1' }]);

      const { PackagingDefinition } = await import('../domain/packaging');
      const pkg = PackagingDefinition.create({
        id: 'pkg-1',
        organizationId: ORG_ID,
        name: 'Box of 12',
        unitId: 'unit-1',
        factor: '12',
      });
      const events = pkg.pullDomainEvents();

      const count = await repo.savePackagingDefinition(executor, pkg, events);
      expect(count).toBe(1);
      expect(executor.insert).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // mapPersistenceError
  // =========================================================================

  describe('mapPersistenceError', () => {
    it('returns non-PG errors unchanged', () => {
      const error = new Error('generic');
      const result = mapPersistenceError(error, {
        action: 'insert',
        table: 'catalog.products',
        organizationId: ORG_ID,
      });
      expect(result).toBe(error);
    });

    it('maps unique_violation to VALIDATION_FAILED', () => {
      const error = { code: '23505', constraint: 'products_org_name_unique' };
      const result = mapPersistenceError(error, {
        action: 'insert',
        table: 'catalog.products',
        organizationId: ORG_ID,
      });
      expect(result).toBeInstanceOf(PlatformError);
    });

    it('preserves unknown constraints as-is in details', () => {
      const error = { code: '23505', constraint: 'unknown_constraint' };
      const result = mapPersistenceError(error, {
        action: 'insert',
        table: 'catalog.products',
        organizationId: ORG_ID,
      });
      expect(result).toBeInstanceOf(PlatformError);
    });

    it('ignores non-23505 codes', () => {
      const error = { code: '23503', constraint: 'some_fk' };
      const result = mapPersistenceError(error, {
        action: 'insert',
        table: 'catalog.products',
        organizationId: ORG_ID,
      });
      expect(result).toBe(error);
    });
  });
});
