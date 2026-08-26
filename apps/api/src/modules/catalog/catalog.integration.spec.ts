import { newId, organizations } from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CatalogRepository } from './infrastructure/catalog.repository';
import { CatalogService } from './application/catalog.service';

/**
 * Native PostgreSQL integration tests for the Catalog bounded context
 * (docs/architecture/91-testing-architecture.md): transactions, unique
 * constraints, composite tenant constraints, transactional outbox and
 * cross-tenant isolation.
 *
 * Uses createTestDatabase() to get a real PG instance, then instantiates
 * CatalogRepository and CatalogService directly (no NestJS).
 */
describe('Catalog context persistence', () => {
  let testdb: TestDatabase;
  let service: CatalogService;
  let repository: CatalogRepository;

  // Pre-seeded test organizations (must exist in organization.organizations
  // before any catalog operations that reference organizationId via FK).
  let orgAId: string;
  let orgBId: string;

  /** Insert a fresh organization for test isolation (unique name per call). */
  async function createTestOrg(): Promise<string> {
    const id = newId();
    await testdb.db.insert(organizations).values({ id, name: `Test Org ${id.slice(0, 8)}` });
    return id;
  }

  beforeAll(async () => {
    testdb = await createTestDatabase();
    repository = new CatalogRepository();
    service = new CatalogService(testdb.db, repository);

    // Seed two test organizations so FK references succeed.
    orgAId = await createTestOrg();
    orgBId = await createTestOrg();
  });

  afterAll(async () => {
    await testdb.teardown();
  });

  // ---------------------------------------------------------------------------
  // Migrations
  // ---------------------------------------------------------------------------

  describe('migrations', () => {
    it('given a fresh database when migrations run then all catalog/integration tables exist', async () => {
      const { rows } = await testdb.client.query<{ table_schema: string; table_name: string }>(
        `SELECT table_schema, table_name FROM information_schema.tables
         WHERE (table_schema = 'catalog' OR table_schema = 'integration')
         ORDER BY table_schema, table_name`,
      );

      const tableNames = rows.map((r) => `${r.table_schema}.${r.table_name}`);
      expect(tableNames).toContain('catalog.products');
      expect(tableNames).toContain('catalog.product_variants');
      expect(tableNames).toContain('catalog.categories');
      expect(tableNames).toContain('catalog.unit_definitions');
      expect(tableNames).toContain('catalog.unit_conversions');
      expect(tableNames).toContain('catalog.packaging_definitions');
      expect(tableNames).toContain('catalog.barcodes');
      expect(tableNames).toContain('integration.outbox');
    });
  });

  // ---------------------------------------------------------------------------
  // Product lifecycle
  // ---------------------------------------------------------------------------

  describe('product lifecycle', () => {
    it('given a new product when created then the row persists with DRAFT status and version 1', async () => {
      const orgId = await createTestOrg();
      const productId = newId();

      const result = await service.createProduct({
        organizationId: orgId,
        productId,
        name: 'Test Product',
        description: 'A test product',
      });

      expect(result.product).toMatchObject({
        id: productId,
        organizationId: orgId,
        name: 'Test Product',
        description: 'A test product',
        status: 'DRAFT',
        version: 1,
      });
      expect(result.eventsPersisted).toBe(1);

      // Verify row in DB
      const { rows } = await testdb.client.query<{ status: string; version: number }>(
        'SELECT status, version FROM catalog.products WHERE id = $1',
        [productId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('DRAFT');
      expect(rows[0].version).toBe(1);
    });

    it('given an existing product when updated then the name and version advance', async () => {
      const orgId = await createTestOrg();
      const { product } = await service.createProduct({
        organizationId: orgId,
        name: 'Original Name',
      });

      const updated = await service.updateProduct({
        organizationId: orgId,
        productId: product.id,
        name: 'Updated Name',
      });

      expect(updated.product.name).toBe('Updated Name');
      expect(updated.product.version).toBe(2);
    });

    it('given a DRAFT product when activated then status becomes ACTIVE', async () => {
      const orgId = await createTestOrg();
      const { product } = await service.createProduct({
        organizationId: orgId,
        name: 'Activatable',
      });
      expect(product.status).toBe('DRAFT');

      const activated = await service.activateProduct({
        organizationId: orgId,
        productId: product.id,
      });

      expect(activated.product.status).toBe('ACTIVE');
      expect(activated.product.version).toBe(2);
    });

    it('given an ACTIVE product when discontinued then status becomes DISCONTINUED', async () => {
      const orgId = await createTestOrg();
      const { product } = await service.createProduct({
        organizationId: orgId,
        name: 'Discontinuable',
      });
      await service.activateProduct({ organizationId: orgId, productId: product.id });

      const discontinued = await service.discontinueProduct({
        organizationId: orgId,
        productId: product.id,
      });

      expect(discontinued.product.status).toBe('DISCONTINUED');
    });
  });

  // ---------------------------------------------------------------------------
  // Variant lifecycle
  // ---------------------------------------------------------------------------

  describe('variant lifecycle', () => {
    it('given a product when a variant is added then the variant persists with DRAFT status', async () => {
      const orgId = await createTestOrg();
      const unitId = newId();
      const { product } = await service.createProduct({
        organizationId: orgId,
        name: 'Variant Parent',
      });
      await service.createUnit({
        organizationId: orgId,
        unitId,
        name: 'Piece',
        symbol: 'pc',
      });

      await service.addVariant({
        organizationId: orgId,
        productId: product.id,
        name: 'Small',
        sku: 'VAR-001',
        baseUnitId: unitId,
      });

      const { rows } = await testdb.client.query<{
        name: string;
        sku: string | null;
        status: string;
      }>('SELECT name, sku, status FROM catalog.product_variants WHERE product_id = $1', [
        product.id,
      ]);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Small');
      expect(rows[0].sku).toBe('VAR-001');
      expect(rows[0].status).toBe('DRAFT');
    });

    it('given a duplicate SKU within the same org when inserted past the aggregate then the DB enforces product_variants_org_sku_unique', async () => {
      const orgId = await createTestOrg();
      const unitId = newId();
      const { product } = await service.createProduct({
        organizationId: orgId,
        name: 'SKU Test Product',
      });
      await service.createUnit({
        organizationId: orgId,
        unitId,
        name: 'Kilogram',
        symbol: 'kg',
      });

      await service.addVariant({
        organizationId: orgId,
        productId: product.id,
        name: 'Variant A',
        sku: 'DUP-SKU',
        baseUnitId: unitId,
      });

      // Direct insert to prove constraint holds bypassing the aggregate
      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO catalog.product_variants
            (id, organization_id, product_id, name, sku, base_unit_id, status, version)
           VALUES ($1, $2, $3, $4, $5, $6, 'DRAFT', 1)`,
          [newId(), orgId, product.id, 'Variant B', 'DUP-SKU', unitId],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23505'); // unique_violation
      expect(dbError?.constraint).toBe('product_variants_org_sku_unique');
    });

    it('given different organizations when both use the same SKU then uniqueness does not leak across tenants', async () => {
      const unitA = newId();
      const unitB = newId();

      const productA = await service.createProduct({
        organizationId: orgAId,
        name: 'OrgA Product',
      });
      await service.createUnit({
        organizationId: orgAId,
        unitId: unitA,
        name: 'Unit A',
        symbol: 'A',
      });

      const productB = await service.createProduct({
        organizationId: orgBId,
        name: 'OrgB Product',
      });
      await service.createUnit({
        organizationId: orgBId,
        unitId: unitB,
        name: 'Unit B',
        symbol: 'B',
      });

      await service.addVariant({
        organizationId: orgAId,
        productId: productA.product.id,
        name: 'OrgA Variant',
        sku: 'SHARED-SKU',
        baseUnitId: unitA,
      });

      // Same SKU in a different org must succeed
      await service.addVariant({
        organizationId: orgBId,
        productId: productB.product.id,
        name: 'OrgB Variant',
        sku: 'SHARED-SKU',
        baseUnitId: unitB,
      });

      const { rows } = await testdb.client.query<{ count: string }>(
        'SELECT count(*) AS count FROM catalog.product_variants WHERE sku = $1',
        ['SHARED-SKU'],
      );
      expect(rows[0].count).toBe('2');
    });

    it('given a variant when updated then the name and version advance', async () => {
      const orgId = await createTestOrg();
      const unitId = newId();
      const { product } = await service.createProduct({
        organizationId: orgId,
        name: 'Update Variant Product',
      });
      await service.createUnit({ organizationId: orgId, unitId, name: 'Unit', symbol: 'u' });

      await service.addVariant({
        organizationId: orgId,
        productId: product.id,
        name: 'Old Name',
        sku: 'UV-001',
        baseUnitId: unitId,
      });
      const variantId = (await repository.findProduct(testdb.db, orgId, product.id))!.variants[0]
        .id;

      const result = await service.updateVariant({
        organizationId: orgId,
        productId: product.id,
        variantId,
        name: 'New Name',
      });

      expect(result.product).toBeDefined();
      const reloaded = await repository.findProduct(testdb.db, orgId, product.id);
      expect(reloaded!.variants[0].name).toBe('New Name');
    });

    it('given an ACTIVE variant when discontinued then the variant status changes', async () => {
      const orgId = await createTestOrg();
      const unitId = newId();
      const { product } = await service.createProduct({
        organizationId: orgId,
        name: 'Discontinue Variant Product',
      });
      await service.createUnit({ organizationId: orgId, unitId, name: 'Unit', symbol: 'u' });

      await service.addVariant({
        organizationId: orgId,
        productId: product.id,
        name: 'Discontinued',
        sku: 'DV-001',
        baseUnitId: unitId,
      });
      const variantId = (await repository.findProduct(testdb.db, orgId, product.id))!.variants[0]
        .id;
      await service.activateVariant({ organizationId: orgId, productId: product.id, variantId });
      await service.discontinueVariant({ organizationId: orgId, productId: product.id, variantId });

      const reloaded = await repository.findVariant(testdb.db, orgId, variantId);
      expect(reloaded).not.toBeNull();
      expect(reloaded!.status).toBe('DISCONTINUED');
    });
  });

  // ---------------------------------------------------------------------------
  // Category hierarchy
  // ---------------------------------------------------------------------------

  describe('category hierarchy', () => {
    it('given a category with no parent when created then it persists as a root category', async () => {
      const orgId = await createTestOrg();
      const result = await service.createCategory({
        organizationId: orgId,
        name: 'Beverages',
        sortOrder: 1,
      });

      expect(result.category).toMatchObject({
        name: 'Beverages',
        parentId: null,
        isActive: true,
        version: 1,
      });
    });

    it('given a parent category when a child is created with parentId then the composite tenant FK links them', async () => {
      const orgId = await createTestOrg();
      const parent = await service.createCategory({
        organizationId: orgId,
        name: 'Food',
      });

      const child = await service.createCategory({
        organizationId: orgId,
        name: 'Snacks',
        parentId: parent.category.id,
      });

      expect(child.category.parentId).toBe(parent.category.id);

      const { rows } = await testdb.client.query<{ parent_id: string | null }>(
        'SELECT parent_id FROM catalog.categories WHERE id = $1',
        [child.category.id],
      );
      expect(rows[0].parent_id).toBe(parent.category.id);
    });

    it('given a category from org A when a cross-tenant parent FK is inserted directly then the composite FK rejects it', async () => {
      const parentA = await service.createCategory({
        organizationId: orgAId,
        name: 'Org A Category',
      });

      // Attempt to insert a category in orgB pointing at orgA's parent
      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO catalog.categories
            (id, organization_id, parent_id, name, sort_order, is_active, version)
           VALUES ($1, $2, $3, $4, 1, true, 1)`,
          [newId(), orgBId, parentA.category.id, 'Cross-tenant child'],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23503'); // foreign_key_violation
    });
  });

  // ---------------------------------------------------------------------------
  // Unit definitions
  // ---------------------------------------------------------------------------

  describe('unit definitions', () => {
    it('given a unit when created then name and symbol are unique within the org', async () => {
      const orgId = await createTestOrg();
      const result = await service.createUnit({
        organizationId: orgId,
        name: 'Kilogram',
        symbol: 'kg',
        isBaseUnit: true,
      });

      expect(result.unit).toMatchObject({
        name: 'Kilogram',
        symbol: 'kg',
        isBaseUnit: true,
        version: 1,
      });
    });

    it('given a duplicate unit name within the same org when inserted past the aggregate then the DB enforces unit_definitions_org_name_unique', async () => {
      const orgId = await createTestOrg();
      await service.createUnit({ organizationId: orgId, name: 'Liter', symbol: 'L' });

      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO catalog.unit_definitions (id, organization_id, name, symbol, is_base_unit, version)
           VALUES ($1, $2, 'Liter', 'lt', false, 1)`,
          [newId(), orgId],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23505');
      expect(dbError?.constraint).toBe('unit_definitions_org_name_unique');
    });

    it('given a duplicate unit symbol within the same org when inserted past the aggregate then the DB enforces unit_definitions_org_symbol_unique', async () => {
      const orgId = await createTestOrg();
      await service.createUnit({ organizationId: orgId, name: 'Gram', symbol: 'g' });

      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO catalog.unit_definitions (id, organization_id, name, symbol, is_base_unit, version)
           VALUES ($1, $2, 'OtherGram', 'g', false, 1)`,
          [newId(), orgId],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23505');
      expect(dbError?.constraint).toBe('unit_definitions_org_symbol_unique');
    });
  });

  // ---------------------------------------------------------------------------
  // Unit conversions
  // ---------------------------------------------------------------------------

  describe('unit conversions', () => {
    it('given two units when a conversion is created then the factor is persisted correctly', async () => {
      const orgId = await createTestOrg();
      const unitA = await service.createUnit({
        organizationId: orgId,
        name: 'Kilogram',
        symbol: 'kg',
        isBaseUnit: true,
      });
      const unitB = await service.createUnit({
        organizationId: orgId,
        name: 'Gram',
        symbol: 'g',
      });

      const result = await service.createConversion({
        organizationId: orgId,
        fromUnitId: unitA.unit.id,
        toUnitId: unitB.unit.id,
        factor: '1000.00000000',
      });

      expect(result.conversionId).toBeDefined();

      const conversions = await repository.findConversions(testdb.db, orgId);
      expect(conversions).toHaveLength(1);
      expect(conversions[0]).toMatchObject({
        fromUnitId: unitA.unit.id,
        toUnitId: unitB.unit.id,
        factor: '1000.00000000',
      });
    });

    it('given a duplicate from+to pair within the same org when inserted past the aggregate then the DB enforces unit_conversions_org_from_to_unique', async () => {
      const orgId = await createTestOrg();
      const unitA = await service.createUnit({
        organizationId: orgId,
        name: 'Meter',
        symbol: 'm',
        isBaseUnit: true,
      });
      const unitB = await service.createUnit({
        organizationId: orgId,
        name: 'Centimeter',
        symbol: 'cm',
      });

      await service.createConversion({
        organizationId: orgId,
        fromUnitId: unitA.unit.id,
        toUnitId: unitB.unit.id,
        factor: '100',
      });

      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO catalog.unit_conversions (id, organization_id, from_unit_id, to_unit_id, factor)
           VALUES ($1, $2, $3, $4, '100')`,
          [newId(), orgId, unitA.unit.id, unitB.unit.id],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23505');
      expect(dbError?.constraint).toBe('unit_conversions_org_from_to_unique');
    });
  });

  // ---------------------------------------------------------------------------
  // Barcodes
  // ---------------------------------------------------------------------------

  describe('barcodes', () => {
    it('given a variant when a barcode is added then the barcode persists as active', async () => {
      const orgId = await createTestOrg();
      const unitId = newId();
      const { product } = await service.createProduct({
        organizationId: orgId,
        name: 'Barcode Product',
      });
      await service.createUnit({ organizationId: orgId, unitId, name: 'Unit', symbol: 'u' });
      await service.addVariant({
        organizationId: orgId,
        productId: product.id,
        name: 'Variant',
        sku: 'BC-001',
        baseUnitId: unitId,
      });
      const variantId = (await repository.findProduct(testdb.db, orgId, product.id))!.variants[0]
        .id;

      const result = await service.addBarcode({
        organizationId: orgId,
        variantId,
        barcode: '5901234123457',
      });

      expect(result.barcodeId).toBeDefined();

      const { rows } = await testdb.client.query<{ barcode: string; is_active: boolean }>(
        'SELECT barcode, is_active FROM catalog.barcodes WHERE id = $1',
        [result.barcodeId],
      );
      expect(rows[0].barcode).toBe('5901234123457');
      expect(rows[0].is_active).toBe(true);
    });

    it('given a barcode within the same org when a duplicate is inserted past the aggregate then the DB enforces barcodes_org_barcode_unique', async () => {
      const orgId = await createTestOrg();
      const unitId = newId();
      const { product } = await service.createProduct({
        organizationId: orgId,
        name: 'Barcode Dup Product',
      });
      await service.createUnit({ organizationId: orgId, unitId, name: 'Unit', symbol: 'u' });
      await service.addVariant({
        organizationId: orgId,
        productId: product.id,
        name: 'Variant',
        sku: 'BD-001',
        baseUnitId: unitId,
      });
      const variantId = (await repository.findProduct(testdb.db, orgId, product.id))!.variants[0]
        .id;

      await service.addBarcode({
        organizationId: orgId,
        variantId,
        barcode: 'UNIQUE-BARCODE-001',
      });

      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO catalog.barcodes (id, organization_id, variant_id, barcode, is_active)
           VALUES ($1, $2, $3, 'UNIQUE-BARCODE-001', true)`,
          [newId(), orgId, variantId],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23505');
      expect(dbError?.constraint).toBe('barcodes_org_barcode_unique');
    });

    it('given an active barcode when deactivated then is_active becomes false', async () => {
      const orgId = await createTestOrg();
      const unitId = newId();
      const { product } = await service.createProduct({
        organizationId: orgId,
        name: 'Barcode Deactivate Product',
      });
      await service.createUnit({ organizationId: orgId, unitId, name: 'Unit', symbol: 'u' });
      await service.addVariant({
        organizationId: orgId,
        productId: product.id,
        name: 'Variant',
        sku: 'BD-002',
        baseUnitId: unitId,
      });
      const variantId = (await repository.findProduct(testdb.db, orgId, product.id))!.variants[0]
        .id;

      const { barcodeId } = await service.addBarcode({
        organizationId: orgId,
        variantId,
        barcode: 'DEACTIVATE-ME',
      });

      const { deactivated } = await service.deactivateBarcode({
        organizationId: orgId,
        barcodeId,
      });
      expect(deactivated).toBe(true);

      const { rows } = await testdb.client.query<{ is_active: boolean }>(
        'SELECT is_active FROM catalog.barcodes WHERE id = $1',
        [barcodeId],
      );
      expect(rows[0].is_active).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-tenant isolation
  // ---------------------------------------------------------------------------

  describe('cross-tenant isolation', () => {
    it('given a product in org A when read from org B then findProduct returns null', async () => {
      const { product } = await service.createProduct({
        organizationId: orgAId,
        name: 'Org A Product',
      });

      const foundFromOrgB = await repository.findProduct(testdb.db, orgBId, product.id);
      expect(foundFromOrgB).toBeNull();
    });

    it('given a variant in org A when read from org B then findVariant returns null', async () => {
      const unitId = newId();

      const { product } = await service.createProduct({
        organizationId: orgAId,
        name: 'Org A Variant Parent',
      });
      await service.createUnit({ organizationId: orgAId, unitId, name: 'Unit', symbol: 'u' });
      await service.addVariant({
        organizationId: orgAId,
        productId: product.id,
        name: 'Isolated Variant',
        sku: 'ISO-001',
        baseUnitId: unitId,
      });
      const variantId = (await repository.findProduct(testdb.db, orgAId, product.id))!.variants[0]
        .id;

      const foundFromOrgB = await repository.findVariant(testdb.db, orgBId, variantId);
      expect(foundFromOrgB).toBeNull();
    });

    it('given a category in org A when read from org B then findCategory returns null', async () => {
      const { category } = await service.createCategory({
        organizationId: orgAId,
        name: 'Isolation Category',
      });

      const foundFromOrgB = await repository.findCategory(testdb.db, orgBId, category.id);
      expect(foundFromOrgB).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Transactional outbox
  // ---------------------------------------------------------------------------

  describe('transactional outbox', () => {
    it('given a product creation when persisted then one ProductCreated event is appended to integration.outbox', async () => {
      const orgId = await createTestOrg();
      const productId = newId();

      await service.createProduct({
        organizationId: orgId,
        productId,
        name: 'Outbox Product',
      });

      const { rows } = await testdb.client.query<{
        event_type: string;
        aggregate_type: string;
      }>(
        `SELECT event_type, aggregate_type FROM integration.outbox
         WHERE aggregate_id = $1 ORDER BY created_at`,
        [productId],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].event_type).toBe('catalog.product-created');
      expect(rows[0].aggregate_type).toBe('Catalog');
    });

    it('given a product with a variant when persisted then two events are appended (ProductCreated + VariantAdded)', async () => {
      const orgId = await createTestOrg();
      const productId = newId();
      const unitId = newId();

      await service.createUnit({ organizationId: orgId, unitId, name: 'Unit', symbol: 'u' });
      await service.createProduct({
        organizationId: orgId,
        productId,
        name: 'Multi-Event Product',
      });
      await service.addVariant({
        organizationId: orgId,
        productId,
        name: 'First Variant',
        sku: 'ME-001',
        baseUnitId: unitId,
      });

      const { rows } = await testdb.client.query<{ event_type: string }>(
        `SELECT event_type FROM integration.outbox
         WHERE aggregate_id = $1 ORDER BY created_at`,
        [productId],
      );

      expect(rows.map((r) => r.event_type)).toEqual([
        'catalog.product-created',
        'catalog.variant-added',
      ]);
    });
  });
});
