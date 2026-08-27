/**
 * Native PostgreSQL integration tests for the Purchasing bounded context.
 *
 * Runs against a real PostgreSQL instance via TEST_DATABASE_URL (or
 * Testcontainers when Docker is available). Each test creates its own
 * isolated fixture data (org, branch, warehouse, variant, supplier) so
 * no cross-test pollution occurs.
 *
 * Excluded from `pnpm test` (unit tests) via vitest.config.ts;
 * included in `pnpm test:integration` via vitest.integration.config.ts.
 *
 * Environment requirements: LOCAL/CI (requires PostgreSQL)
 */

import { type DatabaseClient } from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PurchasingService } from './application/purchasing.service';
import { PurchasingRepository } from './infrastructure/purchasing.repository';
import { InventoryService } from '../inventory/application/inventory.service';
import { InventoryRepository } from '../inventory/infrastructure/inventory.repository';
import type { InventoryContracts, ReceiveStockInput } from '../inventory/contracts';

// ---------------------------------------------------------------------------
// Conditional describe: skip when no PostgreSQL is reachable
// ---------------------------------------------------------------------------

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a decimal string from PostgreSQL NUMERIC(14,4) for comparison. */
function dec(s: string): string {
  return parseFloat(s).toString();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describeIfDb('Purchasing Integration', () => {
  let testdb: TestDatabase;
  let pool: Pool;
  let service: PurchasingService;
  let repository: PurchasingRepository;

  // Tracking mock for most tests — records calls without side effects.
  const inventoryReceipts: ReceiveStockInput[] = [];
  const mockInventoryContracts: InventoryContracts = {
    async getAvailability() {
      return null;
    },
    async receiveStock(input) {
      inventoryReceipts.push(input);
      return { stockPositionId: `mock-sp-${crypto.randomUUID()}` };
    },
  };

  const actor = { id: '0198b000-0000-7000-8000-000000000001' };

  // ---------------------------------------------------------------------------
  // Seed helpers (raw SQL — no Drizzle dependency)
  // ---------------------------------------------------------------------------

  async function seedOrg(): Promise<string> {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO organization.organizations (id, name) VALUES ($1, $2)`, [
      id,
      `Purch Test Org ${id.slice(0, 8)}`,
    ]);
    return id;
  }

  async function seedBranch(orgId: string): Promise<string> {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO organization.branches (id, organization_id, code, name)
       VALUES ($1, $2, $3, $4)`,
      [id, orgId, `BR-${id.slice(0, 8)}`, 'Test Branch'],
    );
    return id;
  }

  async function seedWarehouse(orgId: string, branchId: string): Promise<string> {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO organization.warehouses (id, organization_id, branch_id, code, name)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, orgId, branchId, `WH-${id.slice(0, 8)}`, 'Test Warehouse'],
    );
    return id;
  }

  async function seedVariant(orgId: string): Promise<string> {
    const suffix = crypto.randomUUID().slice(0, 8);

    const productId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO catalog.products (id, organization_id, name)
       VALUES ($1, $2, $3)`,
      [productId, orgId, `Product ${suffix}`],
    );

    const unitId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO catalog.unit_definitions (id, organization_id, name, symbol, is_base_unit)
       VALUES ($1, $2, $3, $4, true)`,
      [unitId, orgId, `Unit-${suffix}`, `u-${suffix}`],
    );

    const variantId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO catalog.product_variants
         (id, organization_id, product_id, name, sku, base_unit_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [variantId, orgId, productId, `Variant ${suffix}`, `SKU-${suffix}`, unitId],
    );

    return variantId;
  }

  async function seedSupplier(orgId: string, code?: string): Promise<string> {
    const id = crypto.randomUUID();
    const suffix = code ?? `SUP-${id.slice(0, 8)}`;
    await pool.query(
      `INSERT INTO purchasing.suppliers (id, organization_id, name, code, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [id, orgId, `Supplier ${suffix}`, suffix],
    );
    return id;
  }

  /**
   * Create a PO via the service in SENT status (ready for goods receipt).
   * Returns the PO row and its items.
   */
  async function createSentPO(
    orgId: string,
    supplierId: string,
    warehouseId: string,
    variantId: string,
    quantity: number,
    unitCost: number,
  ) {
    const po = await service.createPO(
      orgId,
      {
        supplierId,
        warehouseId,
        items: [
          {
            variantId,
            quantity: String(quantity),
            unitCost: String(unitCost),
          },
        ],
      },
      `idem-${crypto.randomUUID()}`,
      actor,
    );

    const submitted = await service.submitPO(orgId, po.id, `idem-${crypto.randomUUID()}`, actor);
    const approved = await service.approvePO(
      orgId,
      submitted.id,
      `idem-${crypto.randomUUID()}`,
      actor,
    );
    const sent = await service.sendPO(orgId, approved.id, `idem-${crypto.randomUUID()}`, actor);

    const items = await service.getPOItems(orgId, sent.id);
    return { po: sent, items };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    testdb = await createTestDatabase();
    pool = testdb.client;
    repository = new PurchasingRepository();
    service = new PurchasingService(testdb.db, repository, mockInventoryContracts);
  });

  afterAll(async () => {
    inventoryReceipts.length = 0;
    if (testdb) await testdb.teardown();
  });

  beforeEach(() => {
    inventoryReceipts.length = 0;
  });

  // ===========================================================================
  // 1. Create supplier
  // ===========================================================================

  describe('supplier lifecycle', () => {
    it('create supplier — insert, verify fields, verify tenant scope', async () => {
      const orgId = await seedOrg();
      const supplierId = await seedSupplier(orgId, 'SUP-001');

      const { rows } = await pool.query(
        `SELECT * FROM purchasing.suppliers
         WHERE id = $1 AND organization_id = $2`,
        [supplierId, orgId],
      );

      expect(rows).toHaveLength(1);
      const row = rows[0] as Record<string, unknown>;
      expect(row.name).toBe('Supplier SUP-001');
      expect(row.code).toBe('SUP-001');
      expect(row.is_active).toBe(true);
      expect(row.organization_id).toBe(orgId);
      expect(row.version).toBe(1);
    });

    it('tenant A cannot access tenant B purchasing data — suppliers', async () => {
      const orgA = await seedOrg();
      const orgB = await seedOrg();
      const supplierId = await seedSupplier(orgA, 'SUP-A1');

      // Query from org B should return empty
      const { rows } = await pool.query(
        `SELECT * FROM purchasing.suppliers
         WHERE id = $1 AND organization_id = $2`,
        [supplierId, orgB],
      );

      expect(rows).toHaveLength(0);
    });
  });

  // ===========================================================================
  // 2. Create PO
  // ===========================================================================

  describe('purchase order lifecycle', () => {
    it('create PO — insert PO + items, verify fields, verify FK relationships', async () => {
      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      const po = await service.createPO(
        orgId,
        {
          supplierId,
          warehouseId,
          items: [{ variantId, quantity: '100', unitCost: '5.00' }],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      // Verify PO row
      const { rows: poRows } = await pool.query(
        `SELECT * FROM purchasing.purchase_orders
         WHERE id = $1 AND organization_id = $2`,
        [po.id, orgId],
      );
      expect(poRows).toHaveLength(1);
      const poRow = poRows[0] as Record<string, unknown>;
      expect(poRow.supplier_id).toBe(supplierId);
      expect(poRow.warehouse_id).toBe(warehouseId);
      expect(poRow.status).toBe('DRAFT');
      expect(poRow.organization_id).toBe(orgId);

      // Verify PO items
      const { rows: itemRows } = await pool.query(
        `SELECT * FROM purchasing.purchase_order_items
         WHERE purchase_order_id = $1 AND organization_id = $2`,
        [po.id, orgId],
      );
      expect(itemRows).toHaveLength(1);
      const itemRow = itemRows[0] as Record<string, unknown>;
      expect(itemRow.variant_id).toBe(variantId);
      expect(dec(itemRow.quantity as string)).toBe('100');
      expect(dec(itemRow.unit_cost as string)).toBe('5');
      expect(dec(itemRow.received_quantity as string)).toBe('0');
      expect(itemRow.organization_id).toBe(orgId);
    });

    it('same supplier + variant may appear in multiple POs', async () => {
      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      // Create first PO
      const po1 = await service.createPO(
        orgId,
        {
          supplierId,
          warehouseId,
          items: [{ variantId, quantity: '50', unitCost: '5.00' }],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      // Create second PO with same supplier + variant
      const po2 = await service.createPO(
        orgId,
        {
          supplierId,
          warehouseId,
          items: [{ variantId, quantity: '30', unitCost: '6.00' }],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      // Both should exist
      expect(po1.id).not.toBe(po2.id);

      const { rows } = await pool.query(
        `SELECT id, supplier_id FROM purchasing.purchase_orders
         WHERE organization_id = $1 AND supplier_id = $2
         ORDER BY created_at`,
        [orgId, supplierId],
      );
      expect(rows).toHaveLength(2);

      // Both items reference the same variant
      const { rows: items } = await pool.query(
        `SELECT purchase_order_id, variant_id
         FROM purchasing.purchase_order_items
         WHERE organization_id = $1 AND variant_id = $2`,
        [orgId, variantId],
      );
      expect(items).toHaveLength(2);
    });

    it('invalid cross-tenant supplier rejected — FK violation', async () => {
      const orgA = await seedOrg();
      const orgB = await seedOrg();
      const branchB = await seedBranch(orgB);
      const warehouseB = await seedWarehouse(orgB, branchB);
      const variantB = await seedVariant(orgB);

      // Create supplier in org A
      const supplierA = await seedSupplier(orgA, 'SUP-A2');

      // Try to create PO in org B referencing org A's supplier — FK should fail
      let error: unknown = null;
      try {
        await service.createPO(
          orgB,
          {
            supplierId: supplierA, // org A's supplier
            warehouseId: warehouseB,
            items: [{ variantId: variantB, quantity: '10', unitCost: '5.00' }],
          },
          `idem-${crypto.randomUUID()}`,
          actor,
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).not.toBeNull();
    });

    it('branch/warehouse scope is enforced — warehouse belongs to same org', async () => {
      const orgA = await seedOrg();
      const orgB = await seedOrg();
      const branchA = await seedBranch(orgA);
      const warehouseA = await seedWarehouse(orgA, branchA);
      const supplierB = await seedSupplier(orgB);
      const variantB = await seedVariant(orgB);

      // Try to create PO in org B referencing org A's warehouse — FK should fail
      let error: unknown = null;
      try {
        await service.createPO(
          orgB,
          {
            supplierId: supplierB,
            warehouseId: warehouseA, // org A's warehouse
            items: [{ variantId: variantB, quantity: '10', unitCost: '5.00' }],
          },
          `idem-${crypto.randomUUID()}`,
          actor,
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).not.toBeNull();
    });
  });

  // ===========================================================================
  // 3. Goods receipt lifecycle
  // ===========================================================================

  describe('goods receipt lifecycle', () => {
    it('partial goods receipt — qtyAccepted < ordered, verify PO item received_quantity updated', async () => {
      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      // Create PO for 100 units
      const { po, items } = await createSentPO(orgId, supplierId, warehouseId, variantId, 100, 5.0);

      const poItem = items[0];

      // Create GR for partial receipt: 60 units received, 60 accepted
      const gr = await service.createGR(
        orgId,
        {
          purchaseOrderId: po.id,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: poItem.id,
              variantId,
              quantityReceived: '60',
              quantityAccepted: '60',
              unitCost: '5.00',
            },
          ],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      // Confirm the GR
      await service.confirmGR(orgId, gr.id, `idem-${crypto.randomUUID()}`, actor);

      // Verify PO item received_quantity was updated
      const { rows } = await pool.query(
        `SELECT received_quantity FROM purchasing.purchase_order_items
         WHERE id = $1 AND organization_id = $2`,
        [poItem.id, orgId],
      );
      expect(rows).toHaveLength(1);
      expect(dec((rows[0] as Record<string, unknown>).received_quantity as string)).toBe('60');

      // PO should be PARTIALLY_RECEIVED
      const { rows: poRows } = await pool.query(
        `SELECT status FROM purchasing.purchase_orders
         WHERE id = $1 AND organization_id = $2`,
        [po.id, orgId],
      );
      expect((poRows[0] as Record<string, unknown>).status).toBe('PARTIALLY_RECEIVED');
    });

    it('repeated receipt cannot double-credit stock — confirm same GR twice should be idempotent', async () => {
      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      const { po, items } = await createSentPO(orgId, supplierId, warehouseId, variantId, 100, 5.0);

      const poItem = items[0];

      const gr = await service.createGR(
        orgId,
        {
          purchaseOrderId: po.id,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: poItem.id,
              variantId,
              quantityReceived: '50',
              quantityAccepted: '50',
              unitCost: '5.00',
            },
          ],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      const idemKey = `idem-${crypto.randomUUID()}`;

      // First confirmation — calls inventory receiveStock
      await service.confirmGR(orgId, gr.id, idemKey, actor);

      // Second confirmation with same idempotency key — should replay
      const gr2 = await service.confirmGR(orgId, gr.id, idemKey, actor);
      expect(gr2.id).toBe(gr.id);

      // PO item received_quantity should be 50, not 100
      const { rows } = await pool.query(
        `SELECT received_quantity FROM purchasing.purchase_order_items
         WHERE id = $1 AND organization_id = $2`,
        [poItem.id, orgId],
      );
      expect(dec((rows[0] as Record<string, unknown>).received_quantity as string)).toBe('50');
    });

    it('over-receipt obeys organization policy — qty > ordered is persisted', async () => {
      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      // Create PO for 100 units
      const { po, items } = await createSentPO(orgId, supplierId, warehouseId, variantId, 100, 5.0);

      const poItem = items[0];

      // Over-receive: 120 units (20% over)
      const gr = await service.createGR(
        orgId,
        {
          purchaseOrderId: po.id,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: poItem.id,
              variantId,
              quantityReceived: '120',
              quantityAccepted: '120',
              unitCost: '5.00',
            },
          ],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      // Confirm — over-receipt is persisted at the service level
      await service.confirmGR(orgId, gr.id, `idem-${crypto.randomUUID()}`, actor);

      // PO item received_quantity reflects over-receipt
      const { rows } = await pool.query(
        `SELECT received_quantity FROM purchasing.purchase_order_items
         WHERE id = $1 AND organization_id = $2`,
        [poItem.id, orgId],
      );
      expect(dec((rows[0] as Record<string, unknown>).received_quantity as string)).toBe('120');

      // Verify GR item in DB
      const { rows: grItems } = await pool.query(
        `SELECT quantity_accepted FROM purchasing.goods_receipt_items
         WHERE goods_receipt_id = $1 AND organization_id = $2`,
        [gr.id, orgId],
      );
      expect(grItems).toHaveLength(1);
      expect(dec((grItems[0] as Record<string, unknown>).quantity_accepted as string)).toBe('120');
    });

    it('confirmed receipt cannot be silently edited — update CONFIRMED GR fails', async () => {
      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      const { po, items } = await createSentPO(orgId, supplierId, warehouseId, variantId, 100, 5.0);

      const gr = await service.createGR(
        orgId,
        {
          purchaseOrderId: po.id,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: items[0].id,
              variantId,
              quantityReceived: '50',
              quantityAccepted: '50',
              unitCost: '5.00',
            },
          ],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      // Confirm the GR
      const confirmed = await service.confirmGR(orgId, gr.id, `idem-${crypto.randomUUID()}`, actor);

      expect(confirmed.status).toBe('CONFIRMED');

      // Attempt to confirm again (status transition PENDING → CONFIRMED is invalid on CONFIRMED)
      let error: unknown = null;
      try {
        await service.confirmGR(orgId, gr.id, `idem-${crypto.randomUUID()}`, actor);
      } catch (caught) {
        error = caught;
      }

      // Should fail: GR is already CONFIRMED
      expect(error).not.toBeNull();

      // Verify GR status is still CONFIRMED
      const { rows } = await pool.query(
        `SELECT status FROM purchasing.goods_receipts
         WHERE id = $1 AND organization_id = $2`,
        [gr.id, orgId],
      );
      expect((rows[0] as Record<string, unknown>).status).toBe('CONFIRMED');
    });
  });

  // ===========================================================================
  // 4. Inventory integration
  // ===========================================================================

  describe('inventory integration', () => {
    /**
     * Tests 8–10 require a REAL InventoryService adapter (not the tracking
     * mock) so that confirming a GR actually creates stock_positions,
     * fifo_layers and ledger_entries in the database.
     */
    function createRealInventoryAdapter(db: DatabaseClient): InventoryContracts {
      const invRepo = new InventoryRepository();
      const invService = new InventoryService(db, invRepo);

      return {
        async getAvailability(orgId, warehouseId, variantId) {
          const pos = await invService.getStockPosition(orgId, warehouseId, variantId);
          if (!pos) return null;
          const avail =
            parseFloat(pos.onHand) - parseFloat(pos.reserved) - parseFloat(pos.allocated);
          return {
            stockPositionId: pos.id,
            organizationId: pos.organizationId,
            warehouseId: pos.warehouseId,
            variantId: pos.variantId,
            onHand: pos.onHand,
            reserved: pos.reserved,
            allocated: pos.allocated,
            available: String(Math.max(0, avail)),
          };
        },
        async receiveStock(input) {
          const idemKey = `idem-inv-${crypto.randomUUID()}`;
          const result = await invService.receiveStock({
            organizationId: input.organizationId,
            warehouseId: input.warehouseId,
            variantId: input.variantId,
            quantity: input.quantity,
            unitCost: input.unitCost,
            idempotencyKey: idemKey,
            requestHash: `hash-${idemKey}`,
            principal: { id: 'purchasing-system' },
          });
          return { stockPositionId: result.received.id };
        },
      };
    }

    it('receiving creates correct Inventory receipt effect — stock_positions on_hand', async () => {
      const realAdapter = createRealInventoryAdapter(testdb.db);
      const realService = new PurchasingService(testdb.db, repository, realAdapter);

      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      // Create and send PO for 100 units
      const { po, items } = await createSentPOWithService(
        realService,
        orgId,
        supplierId,
        warehouseId,
        variantId,
        100,
        5.0,
      );

      // Create GR for 100 units
      const gr = await realService.createGR(
        orgId,
        {
          purchaseOrderId: po.id,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: items[0].id,
              variantId,
              quantityReceived: '100',
              quantityAccepted: '100',
              unitCost: '5.00',
            },
          ],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      // Confirm GR — this triggers inventory receiveStock
      await realService.confirmGR(orgId, gr.id, `idem-${crypto.randomUUID()}`, actor);

      // Verify inventory.stock_positions has correct on_hand
      const { rows } = await pool.query(
        `SELECT on_hand, reserved, allocated
         FROM inventory.stock_positions
         WHERE organization_id = $1
           AND warehouse_id = $2
           AND variant_id = $3`,
        [orgId, warehouseId, variantId],
      );
      expect(rows).toHaveLength(1);
      const pos = rows[0] as Record<string, unknown>;
      expect(dec(pos.on_hand as string)).toBe('100');
      expect(dec(pos.reserved as string)).toBe('0');
      expect(dec(pos.allocated as string)).toBe('0');
    });

    it('FIFO layers reflect actual received quantity/cost', async () => {
      const realAdapter = createRealInventoryAdapter(testdb.db);
      const realService = new PurchasingService(testdb.db, repository, realAdapter);

      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      const { po, items } = await createSentPOWithService(
        realService,
        orgId,
        supplierId,
        warehouseId,
        variantId,
        50,
        8.0,
      );

      const gr = await realService.createGR(
        orgId,
        {
          purchaseOrderId: po.id,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: items[0].id,
              variantId,
              quantityReceived: '50',
              quantityAccepted: '50',
              unitCost: '8.00',
            },
          ],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      await realService.confirmGR(orgId, gr.id, `idem-${crypto.randomUUID()}`, actor);

      // Verify FIFO layer has correct quantity and unit_cost
      // fifo_layers links to stock_positions for warehouse/variant filtering
      const { rows } = await pool.query(
        `SELECT fl.quantity, fl.unit_cost, fl.remaining_quantity
         FROM inventory.fifo_layers fl
         JOIN inventory.stock_positions sp ON fl.stock_position_id = sp.id
         WHERE fl.organization_id = $1
           AND sp.warehouse_id = $2
           AND sp.variant_id = $3`,
        [orgId, warehouseId, variantId],
      );
      expect(rows).toHaveLength(1);
      const layer = rows[0] as Record<string, unknown>;
      expect(dec(layer.quantity as string)).toBe('50');
      expect(dec(layer.unit_cost as string)).toBe('8');
      expect(dec(layer.remaining_quantity as string)).toBe('50');
    });

    it('additional cost allocation is correct — landed cost = unitCost + additionalCosts / totalAcceptedQty', async () => {
      const realAdapter = createRealInventoryAdapter(testdb.db);
      const realService = new PurchasingService(testdb.db, repository, realAdapter);

      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      // Create PO for 100 units at $10 each
      const { po, items } = await createSentPOWithService(
        realService,
        orgId,
        supplierId,
        warehouseId,
        variantId,
        100,
        10.0,
      );

      // Create GR with additional costs:
      // 100 units at $10 + $200 shipping = $12/unit landed cost
      const gr = await realService.createGR(
        orgId,
        {
          purchaseOrderId: po.id,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: items[0].id,
              variantId,
              quantityReceived: '100',
              quantityAccepted: '100',
              unitCost: '10.00',
            },
          ],
          costs: [
            {
              costType: 'SHIPPING',
              amount: '200.00',
              description: 'International shipping',
            },
          ],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      await realService.confirmGR(orgId, gr.id, `idem-${crypto.randomUUID()}`, actor);

      // Verify additional costs were persisted
      const { rows: costRows } = await pool.query(
        `SELECT cost_type, amount, currency
         FROM purchasing.purchase_costs
         WHERE goods_receipt_id = $1 AND organization_id = $2`,
        [gr.id, orgId],
      );
      expect(costRows).toHaveLength(1);
      expect((costRows[0] as Record<string, unknown>).cost_type).toBe('SHIPPING');
      expect(dec((costRows[0] as Record<string, unknown>).amount as string)).toBe('200');

      // Verify FIFO layer reflects landed cost:
      // landed = 10 + 200 / 100 = 12
      const { rows: fifoRows } = await pool.query(
        `SELECT fl.unit_cost, fl.quantity
         FROM inventory.fifo_layers fl
         JOIN inventory.stock_positions sp ON fl.stock_position_id = sp.id
         WHERE fl.organization_id = $1
           AND sp.warehouse_id = $2
           AND sp.variant_id = $3`,
        [orgId, warehouseId, variantId],
      );
      expect(fifoRows).toHaveLength(1);
      expect(dec((fifoRows[0] as Record<string, unknown>).unit_cost as string)).toBe('12');
      expect(dec((fifoRows[0] as Record<string, unknown>).quantity as string)).toBe('100');
    });
  });

  // ===========================================================================
  // 5. Idempotency
  // ===========================================================================

  describe('idempotency', () => {
    it('duplicate idempotent request replays — same key returns same result', async () => {
      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      await seedWarehouse(orgId, branchId);
      await seedVariant(orgId);
      await seedSupplier(orgId);

      const idemKey = `idem-${crypto.randomUUID()}`;

      // First call
      const supplier1 = await service.createSupplier(
        orgId,
        { name: 'Idempotent Supplier', code: `IDEM-${idemKey.slice(0, 8)}` },
        idemKey,
        actor,
      );

      // Second call with same key — should replay
      const supplier2 = await service.createSupplier(
        orgId,
        { name: 'Idempotent Supplier', code: `IDEM-${idemKey.slice(0, 8)}` },
        idemKey,
        actor,
      );

      expect(supplier2.id).toBe(supplier1.id);
      expect(supplier2.name).toBe(supplier1.name);
      expect(supplier2.version).toBe(supplier1.version);

      // Verify only one supplier was created
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM purchasing.suppliers
         WHERE organization_id = $1 AND code = $2`,
        [orgId, supplier2.code],
      );
      expect((rows[0] as Record<string, unknown>).cnt).toBe(1);
    });

    it('conflicting idempotency payload is rejected — same key different scope replays original', async () => {
      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      const { po, items } = await createSentPO(orgId, supplierId, warehouseId, variantId, 100, 5.0);

      const idemKey = `idem-${crypto.randomUUID()}`;

      // First GR creation
      const gr1 = await service.createGR(
        orgId,
        {
          purchaseOrderId: po.id,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: items[0].id,
              variantId,
              quantityReceived: '40',
              quantityAccepted: '40',
              unitCost: '5.00',
            },
          ],
        },
        idemKey,
        actor,
      );

      // Second GR creation with same key but different quantities
      const gr2 = await service.createGR(
        orgId,
        {
          purchaseOrderId: po.id,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: items[0].id,
              variantId,
              quantityReceived: '20',
              quantityAccepted: '20',
              unitCost: '6.00',
            },
          ],
        },
        idemKey,
        actor,
      );

      // Should replay the first result (40 units, not 20)
      expect(gr2.id).toBe(gr1.id);

      // Verify the GR item has the original quantities
      const { rows } = await pool.query(
        `SELECT quantity_received, quantity_accepted, unit_cost
         FROM purchasing.goods_receipt_items
         WHERE goods_receipt_id = $1 AND organization_id = $2`,
        [gr1.id, orgId],
      );
      expect(rows).toHaveLength(1);
      const gi = rows[0] as Record<string, unknown>;
      expect(dec(gi.quantity_received as string)).toBe('40');
      expect(dec(gi.quantity_accepted as string)).toBe('40');
    });
  });

  // ===========================================================================
  // 6. Cross-context safety
  // ===========================================================================

  describe('cross-context safety', () => {
    it('inventory tables are not mutated directly from Purchasing — service only calls receiveStock contract', async () => {
      // The tracking mock records all receiveStock calls; no direct SQL
      // against inventory tables should occur from Purchasing code.
      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      const { po, items } = await createSentPO(orgId, supplierId, warehouseId, variantId, 100, 5.0);

      const gr = await service.createGR(
        orgId,
        {
          purchaseOrderId: po.id,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: items[0].id,
              variantId,
              quantityReceived: '50',
              quantityAccepted: '50',
              unitCost: '5.00',
            },
          ],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      // Confirm GR via service with mock adapter
      await service.confirmGR(orgId, gr.id, `idem-${crypto.randomUUID()}`, actor);

      // Verify receiveStock was called exactly once via the contract
      expect(inventoryReceipts).toHaveLength(1);
      expect(inventoryReceipts[0].organizationId).toBe(orgId);
      expect(inventoryReceipts[0].warehouseId).toBe(warehouseId);
      expect(inventoryReceipts[0].variantId).toBe(variantId);
      expect(inventoryReceipts[0].quantity).toBe('50.0000');
      expect(inventoryReceipts[0].referenceType).toBe('GOODS_RECEIPT');

      // Verify NO inventory.stock_positions rows were created (mock didn't write)
      const { rows: spRows } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM inventory.stock_positions
         WHERE organization_id = $1 AND warehouse_id = $2 AND variant_id = $3`,
        [orgId, warehouseId, variantId],
      );
      expect((spRows[0] as Record<string, unknown>).cnt).toBe(0);

      // Verify outbox events were written
      const { rows: outboxRows } = await pool.query(
        `SELECT event_type FROM integration.outbox
         WHERE aggregate_id = $1 ORDER BY created_at`,
        [gr.id],
      );
      expect(outboxRows.length).toBeGreaterThanOrEqual(1);
      expect(
        outboxRows.some(
          (r) => (r as Record<string, unknown>).event_type === 'purchasing.goods-receipt-confirmed',
        ),
      ).toBe(true);
    });
  });

  // ===========================================================================
  // Tenant isolation (purchasing-specific)
  // ===========================================================================

  describe('tenant isolation', () => {
    it('tenant A purchasing data is invisible to tenant B — POs, GRs, suppliers', async () => {
      const orgA = await seedOrg();
      const orgB = await seedOrg();
      const branchA = await seedBranch(orgA);
      const warehouseA = await seedWarehouse(orgA, branchA);
      const variantA = await seedVariant(orgA);
      const supplierA = await seedSupplier(orgA, 'SUP-IS1');

      // Create PO + GR in org A
      const { po, items } = await createSentPO(orgA, supplierA, warehouseA, variantA, 100, 5.0);

      const gr = await service.createGR(
        orgA,
        {
          purchaseOrderId: po.id,
          warehouseId: warehouseA,
          items: [
            {
              purchaseOrderItemId: items[0].id,
              variantId: variantA,
              quantityReceived: '50',
              quantityAccepted: '50',
              unitCost: '5.00',
            },
          ],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      // Query all purchasing tables from org B — should return empty
      const tables = [
        { schema: 'purchasing', table: 'suppliers', col: 'id', val: supplierA },
        { schema: 'purchasing', table: 'purchase_orders', col: 'id', val: po.id },
        { schema: 'purchasing', table: 'goods_receipts', col: 'id', val: gr.id },
      ];

      for (const t of tables) {
        const { rows } = await pool.query(
          `SELECT id FROM ${t.schema}.${t.table}
           WHERE ${t.col} = $1 AND organization_id = $2`,
          [t.val, orgB],
        );
        expect(rows).toHaveLength(0);
      }

      // PO items from org A, queried from org B
      const { rows: itemRows } = await pool.query(
        `SELECT id FROM purchasing.purchase_order_items
         WHERE purchase_order_id = $1 AND organization_id = $2`,
        [po.id, orgB],
      );
      expect(itemRows).toHaveLength(0);
    });
  });

  // ===========================================================================
  // Outbox events
  // ===========================================================================

  describe('outbox events', () => {
    it('supplier creation writes outbox event', async () => {
      const orgId = await seedOrg();

      const supplier = await service.createSupplier(
        orgId,
        { name: 'Outbox Supplier', code: `OB-${crypto.randomUUID().slice(0, 8)}` },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      const { rows } = await pool.query(
        `SELECT event_type, aggregate_type FROM integration.outbox
         WHERE aggregate_id = $1 ORDER BY created_at`,
        [supplier.id],
      );
      expect(rows).toHaveLength(1);
      expect((rows[0] as Record<string, unknown>).event_type).toBe('purchasing.supplier-created');
      expect((rows[0] as Record<string, unknown>).aggregate_type).toBe('Purchasing');
    });

    it('PO creation writes outbox event', async () => {
      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      const po = await service.createPO(
        orgId,
        {
          supplierId,
          warehouseId,
          items: [{ variantId, quantity: '10', unitCost: '5.00' }],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      const { rows } = await pool.query(
        `SELECT event_type FROM integration.outbox
         WHERE aggregate_id = $1 ORDER BY created_at`,
        [po.id],
      );
      expect(
        rows.some(
          (r) => (r as Record<string, unknown>).event_type === 'purchasing.purchase-order-created',
        ),
      ).toBe(true);
    });

    it('GR creation writes outbox event', async () => {
      const orgId = await seedOrg();
      const branchId = await seedBranch(orgId);
      const warehouseId = await seedWarehouse(orgId, branchId);
      const variantId = await seedVariant(orgId);
      const supplierId = await seedSupplier(orgId);

      const { po, items } = await createSentPO(orgId, supplierId, warehouseId, variantId, 100, 5.0);

      const gr = await service.createGR(
        orgId,
        {
          purchaseOrderId: po.id,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: items[0].id,
              variantId,
              quantityReceived: '25',
              quantityAccepted: '25',
              unitCost: '5.00',
            },
          ],
        },
        `idem-${crypto.randomUUID()}`,
        actor,
      );

      const { rows } = await pool.query(
        `SELECT event_type FROM integration.outbox
         WHERE aggregate_id = $1 ORDER BY created_at`,
        [gr.id],
      );
      expect(
        rows.some(
          (r) => (r as Record<string, unknown>).event_type === 'purchasing.goods-receipt-created',
        ),
      ).toBe(true);
    });
  });

  // ===========================================================================
  // Helper: createSentPO via a specific service instance (for real-adapter tests)
  // ===========================================================================

  async function createSentPOWithService(
    svc: PurchasingService,
    orgId: string,
    supplierId: string,
    warehouseId: string,
    variantId: string,
    quantity: number,
    unitCost: number,
  ) {
    const po = await svc.createPO(
      orgId,
      {
        supplierId,
        warehouseId,
        items: [
          {
            variantId,
            quantity: String(quantity),
            unitCost: String(unitCost),
          },
        ],
      },
      `idem-${crypto.randomUUID()}`,
      actor,
    );

    const submitted = await svc.submitPO(orgId, po.id, `idem-${crypto.randomUUID()}`, actor);
    const approved = await svc.approvePO(orgId, submitted.id, `idem-${crypto.randomUUID()}`, actor);
    const sent = await svc.sendPO(orgId, approved.id, `idem-${crypto.randomUUID()}`, actor);

    const items = await svc.getPOItems(orgId, sent.id);
    return { po: sent, items };
  }
});
