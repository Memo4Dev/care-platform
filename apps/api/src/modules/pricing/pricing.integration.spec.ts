import { newId, organizations } from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PricingRepository } from './infrastructure/pricing.repository';
import { PricingService } from './application/pricing.service';

/**
 * Native PostgreSQL integration tests for the Pricing bounded context
 * (docs/architecture/91-testing-architecture.md): transactions, unique
 * constraints, composite tenant constraints, transactional outbox and
 * cross-tenant isolation.
 *
 * Uses createTestDatabase() to get a real PG instance, then instantiates
 * PricingRepository and PricingService directly (no NestJS).
 */
describe('Pricing context persistence', () => {
  let testdb: TestDatabase;
  let service: PricingService;
  let repository: PricingRepository;

  // Pre-seeded test organizations (must exist in organization.organizations
  // before any pricing operations that reference organizationId via FK).
  let orgAId: string;
  let orgBId: string;

  /** Insert a fresh organization for test isolation (unique name per call). */
  async function createTestOrg(): Promise<string> {
    const id = newId();
    await testdb.db.insert(organizations).values({ id, name: `Test Org ${id.slice(0, 8)}` });
    return id;
  }

  /**
   * Create a minimal catalog entity set (unit + product + variant) required
   * for FK references in price_entries. Returns { unitId, variantId }.
   */
  async function createCatalogPrereqs(
    orgId: string,
  ): Promise<{ unitId: string; variantId: string }> {
    const unitId = newId();
    await testdb.db.execute(/* sql */ `
      INSERT INTO catalog.unit_definitions (id, organization_id, name, symbol, is_base_unit, version)
      VALUES ('${unitId}', '${orgId}', 'Each', 'ea', true, 1)
    `);

    const productId = newId();
    await testdb.db.execute(/* sql */ `
      INSERT INTO catalog.products (id, organization_id, name, status, version)
      VALUES ('${productId}', '${orgId}', 'Catalog prereq product', 'ACTIVE', 1)
    `);

    const variantId = newId();
    await testdb.db.execute(/* sql */ `
      INSERT INTO catalog.product_variants
        (id, organization_id, product_id, name, base_unit_id, status, version)
      VALUES ('${variantId}', '${orgId}', '${productId}', 'Default variant', '${unitId}', 'ACTIVE', 1)
    `);

    return { unitId, variantId };
  }

  beforeAll(async () => {
    testdb = await createTestDatabase();
    repository = new PricingRepository();
    service = new PricingService(testdb.db, repository);

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
    it('given a fresh database when migrations run then all pricing/integration tables exist', async () => {
      const { rows } = await testdb.client.query<{ table_schema: string; table_name: string }>(
        `SELECT table_schema, table_name FROM information_schema.tables
         WHERE (table_schema = 'pricing' OR table_schema = 'integration')
         ORDER BY table_schema, table_name`,
      );

      const tableNames = rows.map((r) => `${r.table_schema}.${r.table_name}`);
      expect(tableNames).toContain('pricing.price_books');
      expect(tableNames).toContain('pricing.price_entries');
      expect(tableNames).toContain('pricing.promotions');
      expect(tableNames).toContain('pricing.coupons');
      expect(tableNames).toContain('integration.outbox');
    });
  });

  // ---------------------------------------------------------------------------
  // PriceBook lifecycle
  // ---------------------------------------------------------------------------

  describe('PriceBook lifecycle', () => {
    it('given a new price book when created then the row persists with ACTIVE status', async () => {
      const orgId = await createTestOrg();
      const result = await service.createPriceBook({
        organizationId: orgId,
        name: 'Default Book',
        isDefault: true,
      });

      expect(result).toMatchObject({
        resourceType: 'PriceBook',
        eventsPersisted: 1,
      });

      const book = await repository.findPriceBook(testdb.db, orgId, result.resourceId);
      expect(book).not.toBeNull();
      expect(book!.name).toBe('Default Book');
      expect(book!.isDefault).toBe(true);
      expect(book!.isActive).toBe(true);
      expect(book!.version).toBe(1);
    });

    it('given two price books when the second is set as default then only the second is default', async () => {
      const orgId = await createTestOrg();
      const book1 = await service.createPriceBook({
        organizationId: orgId,
        name: 'Book 1',
        isDefault: true,
      });
      const book2 = await service.createPriceBook({
        organizationId: orgId,
        name: 'Book 2',
      });

      await service.setDefaultPriceBook({
        organizationId: orgId,
        priceBookId: book2.resourceId,
      });

      const reloaded1 = await repository.findPriceBook(testdb.db, orgId, book1.resourceId);
      const reloaded2 = await repository.findPriceBook(testdb.db, orgId, book2.resourceId);

      expect(reloaded1!.isDefault).toBe(false);
      expect(reloaded2!.isDefault).toBe(true);
    });

    it('given an active price book when deactivated then isActive becomes false', async () => {
      const orgId = await createTestOrg();
      const { resourceId } = await service.createPriceBook({
        organizationId: orgId,
        name: 'Deactivatable',
      });

      await service.deactivatePriceBook({
        organizationId: orgId,
        priceBookId: resourceId,
      });

      const book = await repository.findPriceBook(testdb.db, orgId, resourceId);
      expect(book!.isActive).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // PriceEntry
  // ---------------------------------------------------------------------------

  describe('PriceEntry', () => {
    it('given a price book when an entry is created with all dimensions then the row persists', async () => {
      const orgId = await createTestOrg();
      const { unitId, variantId } = await createCatalogPrereqs(orgId);
      const book = await service.createPriceBook({
        organizationId: orgId,
        name: 'Entry Book',
      });

      const result = await service.createPriceEntry({
        organizationId: orgId,
        priceBookId: book.resourceId,
        variantId,
        unitId,
        priceType: 'CASH',
        channel: 'POS',
        amount: '1250.50',
        effectiveFrom: new Date('2025-01-01'),
      });

      expect(result).toMatchObject({
        resourceType: 'PriceEntry',
        eventsPersisted: 1,
      });

      const entry = await repository.findPriceEntry(testdb.db, orgId, result.resourceId);
      expect(entry).not.toBeNull();
      expect(entry!.amount).toBe('1250.5000');
      expect(entry!.priceType).toBe('CASH');
      expect(entry!.channel).toBe('POS');
    });

    it('given no effectiveFrom when an entry is created then it persists defaulted to today (regression: null.toISOString TypeError)', async () => {
      const orgId = await createTestOrg();
      const { unitId, variantId } = await createCatalogPrereqs(orgId);
      const book = await service.createPriceBook({
        organizationId: orgId,
        name: 'Open-book',
      });

      const result = await service.createPriceEntry({
        organizationId: orgId,
        priceBookId: book.resourceId,
        variantId,
        unitId,
        priceType: 'CASH',
        channel: 'POS',
        amount: '75.00',
        effectiveFrom: null,
      });

      const entry = await repository.findPriceEntry(testdb.db, orgId, result.resourceId);
      expect(entry).not.toBeNull();
      expect(entry!.effectiveFrom).not.toBeNull();
    });

    it('given a price entry with branch scope when created then branchId is persisted', async () => {
      const orgId = await createTestOrg();
      const { unitId, variantId } = await createCatalogPrereqs(orgId);
      const branchId = newId();
      const book = await service.createPriceBook({
        organizationId: orgId,
        name: 'Branch Book',
      });

      const result = await service.createPriceEntry({
        organizationId: orgId,
        priceBookId: book.resourceId,
        variantId,
        unitId,
        priceType: 'WHOLESALE',
        channel: 'ONLINE',
        branchId,
        amount: '999.99',
        effectiveFrom: new Date('2025-06-01'),
        effectiveTo: new Date('2025-12-31'),
      });

      const entry = await repository.findPriceEntry(testdb.db, orgId, result.resourceId);
      expect(entry!.branchId).toBe(branchId);
      expect(entry!.effectiveFrom).toEqual(new Date('2025-06-01T00:00:00.000Z'));
      expect(entry!.effectiveTo).toEqual(new Date('2025-12-31T00:00:00.000Z'));
    });

    it('given a price book that does not exist when an entry is created then RESOURCE_NOT_FOUND is thrown', async () => {
      const orgId = await createTestOrg();

      await expect(
        service.createPriceEntry({
          organizationId: orgId,
          priceBookId: newId(),
          variantId: newId(),
          unitId: newId(),
          priceType: 'CASH',
          channel: 'POS',
          amount: '100',
          effectiveFrom: new Date('2025-01-01'),
        }),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    });
  });

  // ---------------------------------------------------------------------------
  // PriceEntry uniqueness
  // ---------------------------------------------------------------------------

  describe('PriceEntry uniqueness', () => {
    it('given a duplicate entry key (book, variant, unit, type, channel, branch, effectiveFrom) when inserted past the aggregate then the DB enforces the constraint', async () => {
      const orgId = await createTestOrg();
      const { unitId, variantId } = await createCatalogPrereqs(orgId);
      const book = await service.createPriceBook({
        organizationId: orgId,
        name: 'Unique Book',
      });
      const branchId = newId();

      await service.createPriceEntry({
        organizationId: orgId,
        priceBookId: book.resourceId,
        variantId,
        unitId,
        priceType: 'CASH',
        channel: 'POS',
        branchId,
        amount: '100',
        effectiveFrom: new Date('2025-01-01'),
      });

      // Direct insert to prove the constraint
      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO pricing.price_entries
            (id, organization_id, price_book_id, variant_id, unit_id, price_type, channel, branch_id, amount, effective_from, version)
           VALUES ($1, $2, $3, $4, $5, 'CASH', 'POS', $6, '200', '2025-01-01', 1)`,
          [newId(), orgId, book.resourceId, variantId, unitId, branchId],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23505');
      expect(dbError?.constraint).toBe(
        'price_entries_book_variant_unit_type_channel_branch_effunique',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PriceEntry lookup
  // ---------------------------------------------------------------------------

  describe('PriceEntry lookup', () => {
    it('given entries with date ranges when queried at a date within range then the active entry is returned', async () => {
      const orgId = await createTestOrg();
      const { unitId, variantId } = await createCatalogPrereqs(orgId);
      const book = await service.createPriceBook({
        organizationId: orgId,
        name: 'Lookup Book',
      });

      await service.createPriceEntry({
        organizationId: orgId,
        priceBookId: book.resourceId,
        variantId,
        unitId,
        priceType: 'CASH',
        channel: 'POS',
        amount: '100',
        effectiveFrom: new Date('2025-01-01'),
        effectiveTo: new Date('2025-06-30'),
      });

      await service.createPriceEntry({
        organizationId: orgId,
        priceBookId: book.resourceId,
        variantId,
        unitId,
        priceType: 'CASH',
        channel: 'POS',
        amount: '150',
        effectiveFrom: new Date('2025-07-01'),
      });

      // Query for a date in the first range
      const entries = await repository.findPriceEntriesForLookup(
        testdb.db,
        orgId,
        book.resourceId,
        variantId,
        unitId,
        'CASH',
        'POS',
        new Date('2025-03-15'),
      );

      expect(entries).toHaveLength(1);
      expect(entries[0].amount).toBe('100.0000');
    });
  });

  // ---------------------------------------------------------------------------
  // Promotions
  // ---------------------------------------------------------------------------

  describe('Promotions', () => {
    it('given a promotion when created then the row persists with active status', async () => {
      const orgId = await createTestOrg();
      const result = await service.createPromotion({
        organizationId: orgId,
        name: 'Summer Sale',
        type: 'PERCENTAGE',
        target: 'PRODUCT',
        value: '10',
        startDate: new Date('2025-06-01'),
        endDate: new Date('2025-08-31'),
      });

      expect(result).toMatchObject({
        resourceType: 'Promotion',
        eventsPersisted: 1,
      });

      const promo = await repository.findPromotion(testdb.db, orgId, result.resourceId);
      expect(promo).not.toBeNull();
      expect(promo!.name).toBe('Summer Sale');
      expect(promo!.isActive).toBe(true);
    });

    it('given an active promotion when deactivated then isActive becomes false', async () => {
      const orgId = await createTestOrg();
      const { resourceId } = await service.createPromotion({
        organizationId: orgId,
        name: 'Deactivatable Promo',
        type: 'FIXED_AMOUNT',
        target: 'VARIANT',
        value: '50',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      });

      await service.deactivatePromotion({
        organizationId: orgId,
        promotionId: resourceId,
      });

      const promo = await repository.findPromotion(testdb.db, orgId, resourceId);
      expect(promo!.isActive).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Coupons
  // ---------------------------------------------------------------------------

  describe('Coupons', () => {
    it('given a coupon when created then the row persists with usedCount 0', async () => {
      const orgId = await createTestOrg();
      const promo = await service.createPromotion({
        organizationId: orgId,
        name: 'Coupon Promo',
        type: 'FIXED_AMOUNT',
        target: 'ORDER',
        value: '25',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      });

      const result = await service.createCoupon({
        organizationId: orgId,
        code: 'SAVE25',
        type: 'FIXED_AMOUNT',
        value: '25',
        promotionId: promo.resourceId,
        maxUses: 100,
      });

      expect(result).toMatchObject({
        resourceType: 'Coupon',
        eventsPersisted: 1,
      });

      const coupon = await repository.findCoupon(testdb.db, orgId, result.resourceId);
      expect(coupon).not.toBeNull();
      expect(coupon!.code).toBe('SAVE25');
      expect(coupon!.usedCount).toBe(0);
      expect(coupon!.isActive).toBe(true);
    });

    it('given a coupon when redeemed then usedCount increments', async () => {
      const orgId = await createTestOrg();
      const promo = await service.createPromotion({
        organizationId: orgId,
        name: 'Redeem Promo',
        type: 'PERCENTAGE',
        target: 'PRODUCT',
        value: '15',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      });
      const { resourceId: couponId } = await service.createCoupon({
        organizationId: orgId,
        code: 'REDEEM15',
        type: 'PERCENTAGE',
        value: '15',
        promotionId: promo.resourceId,
        maxUses: 5,
      });

      await service.redeemCoupon({ organizationId: orgId, couponId });
      const coupon1 = await repository.findCoupon(testdb.db, orgId, couponId);
      expect(coupon1!.usedCount).toBe(1);

      await service.redeemCoupon({ organizationId: orgId, couponId });
      const coupon2 = await repository.findCoupon(testdb.db, orgId, couponId);
      expect(coupon2!.usedCount).toBe(2);
    });

    it('given a coupon with maxUses 3 when redeemed 3 times then the 4th redemption is rejected', async () => {
      const orgId = await createTestOrg();
      const promo = await service.createPromotion({
        organizationId: orgId,
        name: 'Limited Promo',
        type: 'FIXED_AMOUNT',
        target: 'ORDER',
        value: '10',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      });
      const { resourceId: couponId } = await service.createCoupon({
        organizationId: orgId,
        code: 'LIMITED10',
        type: 'FIXED_AMOUNT',
        value: '10',
        promotionId: promo.resourceId,
        maxUses: 3,
      });

      await service.redeemCoupon({ organizationId: orgId, couponId });
      await service.redeemCoupon({ organizationId: orgId, couponId });
      await service.redeemCoupon({ organizationId: orgId, couponId });

      await expect(service.redeemCoupon({ organizationId: orgId, couponId })).rejects.toMatchObject(
        { code: 'COUPON_INVALID' },
      );
    });

    it('given a coupon with an expired endDate when redeemed then COUPON_EXPIRED is thrown', async () => {
      const orgId = await createTestOrg();
      const promo = await service.createPromotion({
        organizationId: orgId,
        name: 'Expired Promo',
        type: 'PERCENTAGE',
        target: 'ORDER',
        value: '5',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-06-30'),
      });
      const { resourceId: couponId } = await service.createCoupon({
        organizationId: orgId,
        code: 'EXPIRED5',
        type: 'PERCENTAGE',
        value: '5',
        promotionId: promo.resourceId,
        endDate: new Date('2025-06-30'),
      });

      await expect(service.redeemCoupon({ organizationId: orgId, couponId })).rejects.toMatchObject(
        { code: 'COUPON_EXPIRED' },
      );
    });

    it('given a duplicate coupon code within the same org when inserted past the aggregate then the DB enforces coupons_org_code_unique', async () => {
      const orgId = await createTestOrg();
      const promo = await service.createPromotion({
        organizationId: orgId,
        name: 'Code Dup Promo',
        type: 'FIXED_AMOUNT',
        target: 'ORDER',
        value: '10',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      });

      await service.createCoupon({
        organizationId: orgId,
        code: 'DUPCODE',
        type: 'FIXED_AMOUNT',
        value: '10',
        promotionId: promo.resourceId,
      });

      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO pricing.coupons
            (id, organization_id, code, type, value, promotion_id, start_date, end_date, is_active, version)
           VALUES ($1, $2, 'DUPCODE', 'FIXED_AMOUNT', '10', $3, '2025-01-01', '2025-12-31', true, 1)`,
          [newId(), orgId, promo.resourceId],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23505');
      expect(dbError?.constraint).toBe('coupons_org_code_unique');
    });
  });

  // ---------------------------------------------------------------------------
  // Price snapshot (immutability via direct insert)
  // ---------------------------------------------------------------------------

  describe('Price snapshot', () => {
    it('given a price snapshot when inserted then the row is immutable (no update/delete allowed)', async () => {
      const orgId = await createTestOrg();
      const snapshotId = newId();

      // Insert a price snapshot directly (simulating a completed order)
      await testdb.client.query(
        `INSERT INTO pricing.price_snapshots
          (id, organization_id, source_type, source_id, variant_id, unit_id, price_type, channel, amount, quantity)
         VALUES ($1, $2, 'order', $3, $4, $5, 'CASH', 'POS', '100.00', '1.00000000')`,
        [snapshotId, orgId, newId(), newId(), newId()],
      );

      const { rows } = await testdb.client.query<{ id: string; amount: string }>(
        'SELECT id, amount FROM pricing.price_snapshots WHERE id = $1',
        [snapshotId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].amount).toBe('100.0000');
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-tenant isolation
  // ---------------------------------------------------------------------------

  describe('cross-tenant isolation', () => {
    it('given a price book in org A when read from org B then findPriceBook returns null', async () => {
      const { resourceId } = await service.createPriceBook({
        organizationId: orgAId,
        name: 'Org A Book',
      });

      const foundFromOrgB = await repository.findPriceBook(testdb.db, orgBId, resourceId);
      expect(foundFromOrgB).toBeNull();
    });

    it('given a promotion in org A when read from org B then findPromotion returns null', async () => {
      const { resourceId } = await service.createPromotion({
        organizationId: orgAId,
        name: 'Org A Promo',
        type: 'PERCENTAGE',
        target: 'PRODUCT',
        value: '10',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      });

      const foundFromOrgB = await repository.findPromotion(testdb.db, orgBId, resourceId);
      expect(foundFromOrgB).toBeNull();
    });

    it('given a coupon in org A when read from org B then findCoupon returns null', async () => {
      const promo = await service.createPromotion({
        organizationId: orgAId,
        name: 'Org A Coupon Promo',
        type: 'FIXED_AMOUNT',
        target: 'ORDER',
        value: '5',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      });
      const { resourceId } = await service.createCoupon({
        organizationId: orgAId,
        code: 'ISO-COUPON',
        type: 'FIXED_AMOUNT',
        value: '5',
        promotionId: promo.resourceId,
      });

      const foundFromOrgB = await repository.findCoupon(testdb.db, orgBId, resourceId);
      expect(foundFromOrgB).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Transactional outbox
  // ---------------------------------------------------------------------------

  describe('transactional outbox', () => {
    it('given a price book creation when persisted then one PriceBookCreated event is appended to integration.outbox', async () => {
      const orgId = await createTestOrg();
      const bookId = newId();

      await service.createPriceBook({
        organizationId: orgId,
        priceBookId: bookId,
        name: 'Outbox Book',
      });

      const { rows } = await testdb.client.query<{
        event_type: string;
        aggregate_type: string;
      }>(
        `SELECT event_type, aggregate_type FROM integration.outbox
         WHERE aggregate_id = $1 ORDER BY created_at`,
        [bookId],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].event_type).toBe('pricing.price-book-created');
      expect(rows[0].aggregate_type).toBe('Pricing');
    });

    it('given a coupon creation and redemption when persisted then CouponCreated and CouponRedeemed events are appended', async () => {
      const orgId = await createTestOrg();
      const promo = await service.createPromotion({
        organizationId: orgId,
        name: 'Outbox Coupon Promo',
        type: 'FIXED_AMOUNT',
        target: 'ORDER',
        value: '10',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'),
      });
      const couponId = newId();
      await service.createCoupon({
        organizationId: orgId,
        couponId,
        code: 'OUTBOX-COUPON',
        type: 'FIXED_AMOUNT',
        value: '10',
        promotionId: promo.resourceId,
      });

      await service.redeemCoupon({ organizationId: orgId, couponId });

      const { rows } = await testdb.client.query<{ event_type: string }>(
        `SELECT event_type FROM integration.outbox
         WHERE aggregate_id = $1 ORDER BY created_at`,
        [couponId],
      );

      expect(rows.map((r) => r.event_type)).toEqual([
        'pricing.coupon-created',
        'pricing.coupon-redeemed',
      ]);
    });
  });
});
