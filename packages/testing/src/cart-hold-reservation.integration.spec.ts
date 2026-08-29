import { mkdtemp, mkdir, copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newId, resolveMigrationsFolder, runMigrations } from '@commerce-platform/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from './database';

interface PgErrorLike {
  code?: string;
  constraint?: string;
}

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

async function expectSqlState(run: () => Promise<unknown>, code: string): Promise<PgErrorLike> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeDefined();
  expect(caught).toMatchObject({ code });
  return caught as PgErrorLike;
}

/** Build a disposable migration set ending at 0029 for an actual upgrade test. */
async function createLegacyMigrationsFolder(currentFolder: string): Promise<string> {
  const legacyFolder = await mkdtemp(path.join(tmpdir(), 'care-platform-migrations-'));
  await mkdir(path.join(legacyFolder, 'meta'));

  const journal = JSON.parse(
    await readFile(path.join(currentFolder, 'meta', '_journal.json'), 'utf8'),
  ) as { version: string; dialect: string; entries: JournalEntry[] };
  const legacyEntries = journal.entries.filter((entry) => entry.idx <= 29);

  await Promise.all(
    legacyEntries.map((entry) =>
      copyFile(
        path.join(currentFolder, `${entry.tag}.sql`),
        path.join(legacyFolder, `${entry.tag}.sql`),
      ),
    ),
  );
  await writeFile(
    path.join(legacyFolder, 'meta', '_journal.json'),
    `${JSON.stringify({ ...journal, entries: legacyEntries }, null, 2)}\n`,
  );

  return legacyFolder;
}

/**
 * LOCAL/CI: real PostgreSQL is required. TEST_DATABASE_URL is preferred;
 * Testcontainers remains the existing fallback when Docker is available.
 */
describe('0030 Cart hold and grouped reservation persistence', () => {
  let testdb!: TestDatabase;
  let currentMigrationsFolder!: string;

  const orgA = newId();
  const orgB = newId();
  const branchA = newId();
  const branchA2 = newId();
  const branchB = newId();
  const warehouseA = newId();
  const warehouseA2 = newId();
  const inactiveWarehouseA = newId();
  const warehouseB = newId();
  const unitA = newId();
  const unitB = newId();
  const productA = newId();
  const productB = newId();
  const variantA1 = newId();
  const variantA2 = newId();
  const variantA3 = newId();
  const variantB = newId();
  const stockPositionA1 = newId();
  const stockPositionA2 = newId();
  const stockPositionAOtherWarehouse = newId();
  const stockPositionB = newId();
  const legacyReservationId = newId();
  const legacyReservationItemId = newId();

  async function insertCart(branchId = branchA, organizationId = orgA): Promise<string> {
    const cartId = newId();
    await testdb.client.query(
      `INSERT INTO cart.carts
         (id, organization_id, branch_id, channel, status, version)
       VALUES ($1, $2, $3, 'POS', 'DRAFT', 1)`,
      [cartId, organizationId, branchId],
    );
    return cartId;
  }

  async function insertHold(input: {
    cartId: string;
    branchId?: string;
    warehouseId?: string;
    status?: string;
    ttlMinutes?: number;
    cartVersion?: number;
  }): Promise<string> {
    const holdId = newId();
    await testdb.client.query(
      `INSERT INTO cart.cart_holds
         (id, organization_id, cart_id, branch_id, warehouse_id, cart_version,
          status, ttl_minutes, policy_version, actor_id, correlation_id, causation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11)`,
      [
        holdId,
        orgA,
        input.cartId,
        input.branchId ?? branchA,
        input.warehouseId ?? warehouseA,
        input.cartVersion ?? 1,
        input.status ?? 'PENDING',
        input.ttlMinutes ?? 15,
        newId(),
        `correlation-${holdId}`,
        `causation-${holdId}`,
      ],
    );
    return holdId;
  }

  beforeAll(async () => {
    const resolved = resolveMigrationsFolder();
    if (!resolved) {
      throw new Error('Current Drizzle migrations folder is unavailable.');
    }
    currentMigrationsFolder = resolved;

    const legacyMigrationsFolder = await createLegacyMigrationsFolder(currentMigrationsFolder);
    try {
      testdb = await createTestDatabase({ migrationsFolder: legacyMigrationsFolder });

      await testdb.client.query(
        `INSERT INTO organization.organizations (id, name)
         VALUES ($1, 'Hold Org A'), ($2, 'Hold Org B')`,
        [orgA, orgB],
      );
      await testdb.client.query(
        `INSERT INTO organization.branches (id, organization_id, code, name)
         VALUES
           ($1, $2, 'A1', 'Branch A1'),
           ($3, $2, 'A2', 'Branch A2'),
           ($4, $5, 'B1', 'Branch B1')`,
        [branchA, orgA, branchA2, branchB, orgB],
      );
      await testdb.client.query(
        `INSERT INTO organization.warehouses
           (id, organization_id, branch_id, code, name, is_active)
         VALUES
           ($1, $2, $3, 'WA1', 'Warehouse A1', true),
           ($4, $2, $5, 'WA2', 'Warehouse A2', true),
           ($6, $2, $3, 'WAI', 'Warehouse A Inactive', false),
           ($7, $8, $9, 'WB1', 'Warehouse B1', true)`,
        [
          warehouseA,
          orgA,
          branchA,
          warehouseA2,
          branchA2,
          inactiveWarehouseA,
          warehouseB,
          orgB,
          branchB,
        ],
      );
      await testdb.client.query(
        `INSERT INTO catalog.unit_definitions
           (id, organization_id, name, symbol, is_base_unit)
         VALUES ($1, $2, 'Piece A', 'pc-a', true),
                ($3, $4, 'Piece B', 'pc-b', true)`,
        [unitA, orgA, unitB, orgB],
      );
      await testdb.client.query(
        `INSERT INTO catalog.products (id, organization_id, name, status)
         VALUES ($1, $2, 'Product A', 'ACTIVE'),
                ($3, $4, 'Product B', 'ACTIVE')`,
        [productA, orgA, productB, orgB],
      );
      await testdb.client.query(
        `INSERT INTO catalog.product_variants
           (id, organization_id, product_id, name, sku, base_unit_id, status)
         VALUES
           ($1, $2, $3, 'Variant A1', 'A-1', $4, 'ACTIVE'),
           ($5, $2, $3, 'Variant A2', 'A-2', $4, 'ACTIVE'),
           ($6, $2, $3, 'Variant A3', 'A-3', $4, 'ACTIVE'),
           ($7, $8, $9, 'Variant B', 'B-1', $10, 'ACTIVE')`,
        [variantA1, orgA, productA, unitA, variantA2, variantA3, variantB, orgB, productB, unitB],
      );
      await testdb.client.query(
        `INSERT INTO inventory.stock_positions
           (id, organization_id, warehouse_id, variant_id, on_hand, reserved, allocated)
         VALUES
           ($1, $2, $3, $4, 20.0000, 1.2500, 0),
           ($5, $2, $3, $6, 30.0000, 0, 0),
           ($7, $2, $8, $9, 40.0000, 0, 0),
           ($10, $11, $12, $13, 50.0000, 0, 0)`,
        [
          stockPositionA1,
          orgA,
          warehouseA,
          variantA1,
          stockPositionA2,
          variantA2,
          stockPositionAOtherWarehouse,
          warehouseA2,
          variantA3,
          stockPositionB,
          orgB,
          warehouseB,
          variantB,
        ],
      );

      // Legacy 0029 shape: root position is required and items have no position.
      await testdb.client.query(
        `INSERT INTO inventory.reservations
           (id, organization_id, stock_position_id, status, expires_at, reference_type, reference_id)
         VALUES ($1, $2, $3, 'ACTIVE', now() + interval '10 minutes', 'LEGACY', $4)`,
        [legacyReservationId, orgA, stockPositionA1, newId()],
      );
      await testdb.client.query(
        `INSERT INTO inventory.reservation_items
           (id, organization_id, reservation_id, variant_id, quantity)
         VALUES ($1, $2, $3, $4, 1.2500)`,
        [legacyReservationItemId, orgA, legacyReservationId, variantA1],
      );

      await runMigrations(testdb.db, { migrationsFolder: currentMigrationsFolder });
      // Standard migrator idempotency: 0030 is skipped after its journal row exists.
      await runMigrations(testdb.db, { migrationsFolder: currentMigrationsFolder });
    } finally {
      await rm(legacyMigrationsFolder, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await testdb?.teardown();
  });

  it('applies 0030 over legacy rows, preserves them, and is manually re-applicable', async () => {
    const legacy = await testdb.client.query<{
      stock_position_id: string;
      branch_id: string;
      warehouse_id: string;
      item_stock_position_id: string;
      quantity: string;
    }>(
      `SELECT reservation.stock_position_id,
              reservation.branch_id,
              reservation.warehouse_id,
              item.stock_position_id AS item_stock_position_id,
              item.quantity::text AS quantity
         FROM inventory.reservations AS reservation
         JOIN inventory.reservation_items AS item
           ON item.reservation_id = reservation.id
        WHERE reservation.id = $1`,
      [legacyReservationId],
    );

    expect(legacy.rows[0]).toEqual({
      stock_position_id: stockPositionA1,
      branch_id: branchA,
      warehouse_id: warehouseA,
      item_stock_position_id: stockPositionA1,
      quantity: '1.2500',
    });

    const enumValues = await testdb.client.query<{ enumlabel: string }>(
      `SELECT enumlabel
         FROM pg_enum
        WHERE enumtypid = 'organization.organization_policy_type'::regtype`,
    );
    expect(enumValues.rows.map((row) => row.enumlabel)).toContain('CART');

    await testdb.client.query(
      `INSERT INTO organization.organization_policies
         (id, organization_id, policy_type, value_json, version)
       VALUES ($1, $2, 'CART', '{"holdReservationTtlMinutes":15}'::jsonb, 0)`,
      [newId(), orgA],
    );

    // Reviewed-manual migrations in this repository support safe re-delivery.
    const migrationSql = await readFile(
      path.join(currentMigrationsFolder, '0030_cart_hold_reservation.sql'),
      'utf8',
    );
    await expect(testdb.client.query(migrationSql)).resolves.toBeDefined();

    const preserved = await testdb.client.query<{ reservations: string; items: string }>(
      `SELECT
         (SELECT count(*)::text FROM inventory.reservations WHERE id = $1) AS reservations,
         (SELECT count(*)::text FROM inventory.reservation_items WHERE id = $2) AS items`,
      [legacyReservationId, legacyReservationItemId],
    );
    expect(preserved.rows[0]).toEqual({ reservations: '1', items: '1' });
  });

  it('keeps carts DRAFT and enforces one current hold with bounded TTL', async () => {
    const cartId = await insertCart();
    const firstHold = await insertHold({ cartId, status: 'PENDING', ttlMinutes: 1 });

    const duplicateError = await expectSqlState(
      () => insertHold({ cartId, status: 'ACTIVE', ttlMinutes: 1440 }),
      '23505',
    );
    expect(duplicateError.constraint).toBe('cart_holds_one_current_per_cart_unique');

    await testdb.client.query(
      `UPDATE cart.cart_holds SET status = 'RELEASED', version = version + 1 WHERE id = $1`,
      [firstHold],
    );
    await expect(
      insertHold({ cartId, status: 'RELEASING', ttlMinutes: 1440 }),
    ).resolves.toBeDefined();

    const lowTtlCart = await insertCart();
    const lowTtlError = await expectSqlState(
      () => insertHold({ cartId: lowTtlCart, ttlMinutes: 0 }),
      '23514',
    );
    expect(lowTtlError.constraint).toBe('cart_holds_ttl_minutes_check');

    const highTtlCart = await insertCart();
    const highTtlError = await expectSqlState(
      () => insertHold({ cartId: highTtlCart, ttlMinutes: 1441 }),
      '23514',
    );
    expect(highTtlError.constraint).toBe('cart_holds_ttl_minutes_check');

    const storedCart = await testdb.client.query<{ status: string }>(
      `SELECT status FROM cart.carts WHERE id = $1`,
      [cartId],
    );
    expect(storedCart.rows[0]?.status).toBe('DRAFT');
  });

  it('rejects a foreign-branch or inactive hold warehouse', async () => {
    const wrongBranchCart = await insertCart();
    const wrongBranch = await expectSqlState(
      () => insertHold({ cartId: wrongBranchCart, warehouseId: warehouseA2 }),
      '23503',
    );
    expect(wrongBranch.constraint).toBe('cart_holds_active_warehouse_check');

    const inactiveCart = await insertCart();
    const inactive = await expectSqlState(
      () => insertHold({ cartId: inactiveCart, warehouseId: inactiveWarehouseA }),
      '23503',
    );
    expect(inactive.constraint).toBe('cart_holds_active_warehouse_check');

    const mismatchedCartBranch = await insertCart(branchA2);
    const cartScope = await expectSqlState(
      () =>
        insertHold({ cartId: mismatchedCartBranch, branchId: branchA, warehouseId: warehouseA }),
      '23503',
    );
    expect(cartScope.constraint).toBe('cart_holds_cart_tenant_branch_fk');
  });

  it('supports one grouped reservation across positions in one warehouse', async () => {
    const reservationId = newId();
    const referenceId = newId();
    await testdb.client.query(
      `INSERT INTO inventory.reservations
         (id, organization_id, stock_position_id, branch_id, warehouse_id, status,
          expires_at, reference_type, reference_id, reference_version)
       VALUES ($1, $2, NULL, $3, $4, 'ACTIVE', now() + interval '15 minutes',
               'CART_HOLD', $5, 7)`,
      [reservationId, orgA, branchA, warehouseA, referenceId],
    );
    await testdb.client.query(
      `INSERT INTO inventory.reservation_items
         (id, organization_id, reservation_id, stock_position_id, variant_id, quantity)
       VALUES
         ($1, $2, $3, $4, $5, 1.12345678),
         ($6, $2, $3, $7, $8, 2.00000001)`,
      [
        newId(),
        orgA,
        reservationId,
        stockPositionA1,
        variantA1,
        newId(),
        stockPositionA2,
        variantA2,
      ],
    );

    const grouped = await testdb.client.query<{
      stock_position_id: string | null;
      positions: string;
    }>(
      `SELECT reservation.stock_position_id,
              count(DISTINCT item.stock_position_id)::text AS positions
         FROM inventory.reservations AS reservation
         JOIN inventory.reservation_items AS item ON item.reservation_id = reservation.id
        WHERE reservation.id = $1
        GROUP BY reservation.stock_position_id`,
      [reservationId],
    );
    expect(grouped.rows[0]).toEqual({ stock_position_id: null, positions: '2' });

    const duplicatePosition = await expectSqlState(
      () =>
        testdb.client.query(
          `INSERT INTO inventory.reservation_items
             (id, organization_id, reservation_id, stock_position_id, variant_id, quantity)
           VALUES ($1, $2, $3, $4, $5, 1)`,
          [newId(), orgA, reservationId, stockPositionA1, variantA1],
        ),
      '23505',
    );
    expect(duplicatePosition.constraint).toBe(
      'reservation_items_reservation_stock_position_unique',
    );

    const otherWarehouse = await expectSqlState(
      () =>
        testdb.client.query(
          `INSERT INTO inventory.reservation_items
             (id, organization_id, reservation_id, stock_position_id, variant_id, quantity)
           VALUES ($1, $2, $3, $4, $5, 1)`,
          [newId(), orgA, reservationId, stockPositionAOtherWarehouse, variantA3],
        ),
      '23514',
    );
    expect(otherWarehouse.constraint).toBe('reservation_items_reservation_warehouse_check');

    const foreignTenantPosition = await expectSqlState(
      () =>
        testdb.client.query(
          `INSERT INTO inventory.reservation_items
             (id, organization_id, reservation_id, stock_position_id, variant_id, quantity)
           VALUES ($1, $2, $3, $4, $5, 1)`,
          [newId(), orgA, reservationId, stockPositionB, variantB],
        ),
      '23503',
    );
    expect(foreignTenantPosition.constraint).toBe('reservation_items_stock_position_tenant_fk');

    const duplicateReference = await expectSqlState(
      () =>
        testdb.client.query(
          `INSERT INTO inventory.reservations
             (id, organization_id, stock_position_id, branch_id, warehouse_id, status,
              reference_type, reference_id, reference_version)
           VALUES ($1, $2, NULL, $3, $4, 'ACTIVE', 'CART_HOLD', $5, 7)`,
          [newId(), orgA, branchA, warehouseA, referenceId],
        ),
      '23505',
    );
    expect(duplicateReference.constraint).toBe('reservations_active_reference_unique');
  });

  it('retains legacy insert compatibility and enforces status and positive quantity checks', async () => {
    const reservationId = newId();
    await testdb.client.query(
      `INSERT INTO inventory.reservations
         (id, organization_id, stock_position_id, status, reference_type, reference_id)
       VALUES ($1, $2, $3, 'ACTIVE', 'LEGACY_WRITE', $4)`,
      [reservationId, orgA, stockPositionA2, newId()],
    );
    await testdb.client.query(
      `INSERT INTO inventory.reservation_items
         (id, organization_id, reservation_id, variant_id, quantity)
       VALUES ($1, $2, $3, $4, 1)`,
      [newId(), orgA, reservationId, variantA2],
    );

    const derived = await testdb.client.query<{
      branch_id: string;
      warehouse_id: string;
      stock_position_id: string;
    }>(
      `SELECT reservation.branch_id, reservation.warehouse_id, item.stock_position_id
         FROM inventory.reservations AS reservation
         JOIN inventory.reservation_items AS item ON item.reservation_id = reservation.id
        WHERE reservation.id = $1`,
      [reservationId],
    );
    expect(derived.rows[0]).toEqual({
      branch_id: branchA,
      warehouse_id: warehouseA,
      stock_position_id: stockPositionA2,
    });

    const invalidStatus = await expectSqlState(
      () =>
        testdb.client.query(
          `INSERT INTO inventory.reservations
             (id, organization_id, stock_position_id, status, reference_type, reference_id)
           VALUES ($1, $2, $3, 'PENDING', 'INVALID', $4)`,
          [newId(), orgA, stockPositionA2, newId()],
        ),
      '23514',
    );
    expect(invalidStatus.constraint).toBe('reservations_status_check');

    const zeroQuantity = await expectSqlState(
      () =>
        testdb.client.query(
          `INSERT INTO inventory.reservation_items
             (id, organization_id, reservation_id, stock_position_id, variant_id, quantity)
           VALUES ($1, $2, $3, $4, $5, 0)`,
          [newId(), orgA, reservationId, stockPositionA1, variantA1],
        ),
      '23514',
    );
    // The warehouse/variant trigger runs first, so use a position matching the
    // parent warehouse and assert the declarative positive-quantity check.
    expect(zeroQuantity.constraint).toBe('reservation_items_quantity_positive_check');
  });

  it('uses exact eight-decimal quantities without reducing integer capacity', async () => {
    const quantityColumns = await testdb.client.query<{
      table_name: string;
      column_name: string;
      domain_schema: string | null;
      domain_name: string | null;
    }>(
      `SELECT table_name, column_name, domain_schema, domain_name
         FROM information_schema.columns
        WHERE table_schema = 'inventory'
          AND (table_name, column_name) IN (
            ('stock_positions', 'on_hand'),
            ('stock_positions', 'reserved'),
            ('stock_positions', 'allocated'),
            ('fifo_layers', 'quantity'),
            ('fifo_layers', 'remaining_quantity'),
            ('ledger_entries', 'quantity_change'),
            ('reservation_items', 'quantity'),
            ('stock_transfer_items', 'quantity'),
            ('stock_transfer_items', 'received_quantity'),
            ('stock_adjustments', 'quantity_before'),
            ('stock_adjustments', 'quantity_after')
          )`,
    );
    expect(quantityColumns.rows).toHaveLength(11);
    expect(
      quantityColumns.rows.every(
        (column) => column.domain_schema === 'inventory' && column.domain_name === 'quantity_18_8',
      ),
    ).toBe(true);

    const unitCost = await testdb.client.query<{
      numeric_precision: number;
      numeric_scale: number;
      domain_name: string | null;
    }>(
      `SELECT numeric_precision, numeric_scale, domain_name
         FROM information_schema.columns
        WHERE table_schema = 'inventory'
          AND table_name = 'fifo_layers'
          AND column_name = 'unit_cost'`,
    );
    expect(unitCost.rows[0]).toEqual({
      numeric_precision: 14,
      numeric_scale: 4,
      domain_name: null,
    });

    await testdb.client.query(
      `UPDATE inventory.stock_positions SET on_hand = $1::numeric WHERE id = $2`,
      ['10.12345678', stockPositionA2],
    );
    const exact = await testdb.client.query<{ on_hand: string }>(
      `SELECT on_hand::text AS on_hand FROM inventory.stock_positions WHERE id = $1`,
      [stockPositionA2],
    );
    expect(exact.rows[0]?.on_hand).toBe('10.12345678');

    const excessScale = await expectSqlState(
      () =>
        testdb.client.query(
          `UPDATE inventory.stock_positions SET on_hand = $1::numeric WHERE id = $2`,
          ['10.123456789', stockPositionA2],
        ),
      '23514',
    );
    expect(excessScale.constraint).toBe('quantity_18_8_exact_check');

    const unchanged = await testdb.client.query<{ on_hand: string }>(
      `SELECT on_hand::text AS on_hand FROM inventory.stock_positions WHERE id = $1`,
      [stockPositionA2],
    );
    expect(unchanged.rows[0]?.on_hand).toBe('10.12345678');

    await testdb.client.query(
      `UPDATE inventory.stock_positions SET on_hand = $1::numeric WHERE id = $2`,
      ['9999999999.99999999', stockPositionA2],
    );
    const fullCapacity = await testdb.client.query<{ on_hand: string }>(
      `SELECT on_hand::text AS on_hand FROM inventory.stock_positions WHERE id = $1`,
      [stockPositionA2],
    );
    expect(fullCapacity.rows[0]?.on_hand).toBe('9999999999.99999999');
  });
});
