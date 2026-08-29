import {
  branches,
  newId,
  organizations,
  productVariants,
  products,
  stockPositions,
  unitDefinitions,
  warehouses,
} from '@commerce-platform/database';
import { ERROR_CODES } from '@commerce-platform/contracts';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CreateCartReservationInput } from './contracts';
import { InventoryService } from './application/inventory.service';
import { InventoryRepository } from './infrastructure/inventory.repository';

interface Fixture {
  organizationId: string;
  branchId: string;
  otherBranchId: string;
  warehouseId: string;
  otherWarehouseId: string;
  variantIds: string[];
  positionIds: string[];
}

/** LOCAL/CI: this suite requires real PostgreSQL for locks and transactions. */
describe('Inventory Cart reservation contract', () => {
  let testdb!: TestDatabase;
  let repository!: InventoryRepository;
  let service!: InventoryService;

  beforeAll(async () => {
    testdb = await createTestDatabase({ max: 10 });
    repository = new InventoryRepository();
    service = new InventoryService(testdb.db, repository, {
      async getWarehouse(organizationId, warehouseId) {
        const result = await testdb.client.query<{
          id: string;
          organization_id: string;
          branch_id: string;
          code: string;
          name: string;
          is_active: boolean;
          version: number;
        }>(
          `SELECT id, organization_id, branch_id, code, name, is_active, version
             FROM organization.warehouses
            WHERE organization_id = $1 AND id = $2`,
          [organizationId, warehouseId],
        );
        const row = result.rows[0];
        return row
          ? {
              id: row.id,
              organizationId: row.organization_id,
              branchId: row.branch_id,
              code: row.code,
              name: row.name,
              isActive: row.is_active,
              version: row.version,
            }
          : null;
      },
    });
  });

  afterAll(async () => {
    await testdb?.teardown();
  });

  async function createFixture(onHand: readonly string[]): Promise<Fixture> {
    const organizationId = newId();
    const branchId = newId();
    const otherBranchId = newId();
    const warehouseId = newId();
    const otherWarehouseId = newId();
    await testdb.db.insert(organizations).values({
      id: organizationId,
      name: `Cart Reservation Org ${organizationId}`,
    });
    await testdb.db.insert(branches).values([
      {
        id: branchId,
        organizationId,
        code: `BR-${branchId}`,
        name: 'Reservation Branch',
      },
      {
        id: otherBranchId,
        organizationId,
        code: `BR-${otherBranchId}`,
        name: 'Other Branch',
      },
    ]);
    await testdb.db.insert(warehouses).values([
      {
        id: warehouseId,
        organizationId,
        branchId,
        code: `WH-${warehouseId}`,
        name: 'Reservation Warehouse',
      },
      {
        id: otherWarehouseId,
        organizationId,
        branchId: otherBranchId,
        code: `WH-${otherWarehouseId}`,
        name: 'Other Warehouse',
      },
    ]);

    const unitId = newId();
    const productId = newId();
    await testdb.db.insert(unitDefinitions).values({
      id: unitId,
      organizationId,
      name: `Piece ${unitId}`,
      symbol: `pc-${unitId}`,
      isBaseUnit: true,
    });
    await testdb.db.insert(products).values({
      id: productId,
      organizationId,
      name: `Product ${productId}`,
    });

    const variantIds: string[] = [];
    const positionIds: string[] = [];
    for (const [index, quantity] of onHand.entries()) {
      const variantId = newId();
      const positionId = newId();
      variantIds.push(variantId);
      positionIds.push(positionId);
      await testdb.db.insert(productVariants).values({
        id: variantId,
        organizationId,
        productId,
        name: `Variant ${index}`,
        sku: `SKU-${variantId}`,
        baseUnitId: unitId,
      });
      await testdb.db.insert(stockPositions).values({
        id: positionId,
        organizationId,
        warehouseId,
        variantId,
        onHand: quantity,
      });
    }

    return {
      organizationId,
      branchId,
      otherBranchId,
      warehouseId,
      otherWarehouseId,
      variantIds,
      positionIds,
    };
  }

  function createInput(
    fixture: Fixture,
    demands: CreateCartReservationInput['demands'],
    overrides: Partial<CreateCartReservationInput> = {},
  ): CreateCartReservationInput {
    const referenceId = overrides.referenceId ?? newId();
    const idempotencyKey = overrides.idempotencyKey ?? `cart-hold-${newId()}`;
    return {
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      warehouseId: fixture.warehouseId,
      referenceId,
      cartVersion: 7,
      demands,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      idempotencyKey,
      requestHash: `hash-${idempotencyKey}`,
      correlationId: `correlation-${referenceId}`,
      causationId: `causation-${referenceId}`,
      actorId: newId(),
      ...overrides,
    };
  }

  async function markDue(reservationId: string): Promise<void> {
    await testdb.client.query(
      `UPDATE inventory.reservations SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [reservationId],
    );
  }

  async function effectCounts(reservationId: string): Promise<{
    releaseLedger: string;
    expirationOutbox: string;
  }> {
    const result = await testdb.client.query<{
      release_ledger: string;
      expiration_outbox: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM inventory.ledger_entries
           WHERE reference_type = 'RESERVATION' AND reference_id = $1 AND entry_type = 'RELEASE')
           AS release_ledger,
         (SELECT count(*)::text FROM integration.outbox
           WHERE aggregate_id = $1 AND event_type = 'inventory.reservation-expired')
           AS expiration_outbox`,
      [reservationId],
    );
    return {
      releaseLedger: result.rows[0]!.release_ledger,
      expirationOutbox: result.rows[0]!.expiration_outbox,
    };
  }

  it('creates one successful multi-item hold and aggregates duplicate variants exactly', async () => {
    const fixture = await createFixture(['10', '20']);
    const input = createInput(fixture, [
      { variantId: fixture.variantIds[0]!, quantity: '1.00000001' },
      { variantId: fixture.variantIds[1]!, quantity: '2' },
      { variantId: fixture.variantIds[0]!, quantity: '0.00000002' },
    ]);

    const result = await service.createCartReservation(input);

    expect(result.kind).toBe('ACTIVE');
    if (result.kind !== 'ACTIVE') throw new Error('Expected ACTIVE result.');
    expect(result.reservation.items.map((item) => item.quantity).sort()).toEqual([
      '1.00000003',
      '2.00000000',
    ]);
    const persisted = await testdb.client.query<{
      roots: string;
      items: string;
      reservation_ledger: string;
      outbox: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM inventory.reservations WHERE id = $1) AS roots,
         (SELECT count(*)::text FROM inventory.reservation_items WHERE reservation_id = $1) AS items,
         (SELECT count(*)::text FROM inventory.ledger_entries
           WHERE reference_id = $1 AND entry_type = 'RESERVATION') AS reservation_ledger,
         (SELECT count(*)::text FROM integration.outbox
           WHERE aggregate_id = $1 AND event_type = 'inventory.stock-reserved') AS outbox`,
      [result.reservation.reservationId],
    );
    expect(persisted.rows[0]).toEqual({
      roots: '1',
      items: '2',
      reservation_ledger: '2',
      outbox: '1',
    });
  });

  it('returns every explicit shortage as a completed outcome with zero stock effects', async () => {
    const fixture = await createFixture(['1', '0']);
    const missingVariant = newId();
    const input = createInput(fixture, [
      { variantId: fixture.variantIds[0]!, quantity: '2' },
      { variantId: fixture.variantIds[1]!, quantity: '1' },
      { variantId: missingVariant, quantity: '3' },
    ]);

    const result = await service.createCartReservation(input);
    expect(result.kind).toBe('SHORTAGES');
    if (result.kind !== 'SHORTAGES') throw new Error('Expected shortage result.');
    expect(result.shortages.map((shortage) => shortage.variantId).sort()).toEqual(
      [fixture.variantIds[0]!, fixture.variantIds[1]!, missingVariant].sort(),
    );
    await testdb.client.query(
      `UPDATE inventory.stock_positions SET on_hand = 100 WHERE organization_id = $1`,
      [fixture.organizationId],
    );
    expect(await service.createCartReservation(input)).toEqual(result);

    const persisted = await testdb.client.query<{
      reservations: string;
      ledgers: string;
      outbox: string;
      outcome_status: string;
      reserved: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM inventory.reservations
           WHERE organization_id = $1 AND reference_id = $2) AS reservations,
         (SELECT count(*)::text FROM inventory.ledger_entries
           WHERE organization_id = $1 AND reference_id = $2) AS ledgers,
         (SELECT count(*)::text FROM integration.outbox WHERE aggregate_id = $2) AS outbox,
         (SELECT status FROM integration.idempotency_outcomes WHERE idempotency_key = $3)
           AS outcome_status,
         (SELECT sum(reserved)::text FROM inventory.stock_positions
           WHERE organization_id = $1) AS reserved`,
      [fixture.organizationId, input.referenceId, input.idempotencyKey],
    );
    expect(persisted.rows[0]).toEqual({
      reservations: '0',
      ledgers: '0',
      outbox: '0',
      outcome_status: 'COMPLETED',
      reserved: '0',
    });
  });

  it('rolls back the first item when the second item is short', async () => {
    const fixture = await createFixture(['10', '1']);
    const result = await service.createCartReservation(
      createInput(fixture, [
        { variantId: fixture.variantIds[0]!, quantity: '8' },
        { variantId: fixture.variantIds[1]!, quantity: '2' },
      ]),
    );
    expect(result.kind).toBe('SHORTAGES');
    const balances = await testdb.client.query<{ reserved: string }>(
      `SELECT reserved::text AS reserved FROM inventory.stock_positions
        WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [fixture.positionIds],
    );
    expect(balances.rows.every((row) => row.reserved === '0')).toBe(true);
  });

  it('serializes concurrent holds so contention cannot oversell', async () => {
    const fixture = await createFixture(['10']);
    const outcomes = await Promise.all([
      service.createCartReservation(
        createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '7' }]),
      ),
      service.createCartReservation(
        createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '7' }]),
      ),
    ]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['ACTIVE', 'SHORTAGES']);
    const balance = await testdb.client.query<{ reserved: string; active: string }>(
      `SELECT
         (SELECT reserved::text FROM inventory.stock_positions WHERE id = $1) AS reserved,
         (SELECT count(*)::text FROM inventory.reservations
           WHERE organization_id = $2 AND status = 'ACTIVE') AS active`,
      [fixture.positionIds[0], fixture.organizationId],
    );
    expect(balance.rows[0]).toEqual({ reserved: '7.00000000', active: '1' });
  });

  it('persists exact eight-decimal holds and rejects a ninth decimal before effects', async () => {
    const fixture = await createFixture(['1']);
    const exact = await service.createCartReservation(
      createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '0.00000001' }]),
    );
    expect(exact.kind).toBe('ACTIVE');

    const another = await createFixture(['1']);
    await expect(
      service.createCartReservation(
        createInput(another, [{ variantId: another.variantIds[0]!, quantity: '0.000000001' }]),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    const count = await testdb.client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory.reservations WHERE organization_id = $1`,
      [another.organizationId],
    );
    expect(count.rows[0]?.count).toBe('0');
  });

  it('rejects a changed request hash for a completed Inventory idempotency key', async () => {
    const fixture = await createFixture(['5']);
    const input = createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '1' }]);
    await service.createCartReservation(input);
    await expect(
      service.createCartReservation({ ...input, requestHash: 'changed-hash' }),
    ).rejects.toMatchObject({ code: ERROR_CODES.IDEMPOTENCY_CONFLICT });
  });

  it('atomically converges concurrent duplicate idempotency claims', async () => {
    const fixture = await createFixture(['5']);
    const input = createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '2' }]);
    const [first, second] = await Promise.all([
      service.createCartReservation(input),
      service.createCartReservation(input),
    ]);
    expect(first.kind).toBe('ACTIVE');
    expect(second.kind).toBe('ACTIVE');
    if (first.kind !== 'ACTIVE' || second.kind !== 'ACTIVE') {
      throw new Error('Expected ACTIVE duplicate results.');
    }
    expect(second.reservation.reservationId).toBe(first.reservation.reservationId);
    const ledgers = await testdb.client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM inventory.ledger_entries
        WHERE reference_id = $1 AND entry_type = 'RESERVATION'`,
      [first.reservation.reservationId],
    );
    expect(ledgers.rows[0]?.count).toBe('1');
  });

  it('fails closed when an idempotency claim remains IN_PROGRESS', async () => {
    const fixture = await createFixture(['5']);
    const input = createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '2' }]);
    await testdb.client.query(
      `INSERT INTO integration.idempotency_outcomes
         (id, scope, idempotency_key, request_hash, status)
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS')`,
      [
        newId(),
        `inventory:createCartReservation:${input.organizationId}:${input.actorId}`,
        input.idempotencyKey,
        input.requestHash,
      ],
    );
    await expect(service.createCartReservation(input)).rejects.toMatchObject({
      code: ERROR_CODES.IDEMPOTENCY_CONFLICT,
    });
  });

  it('releases once, converges on replay, never re-reserves, and returns current shortages', async () => {
    const fixture = await createFixture(['5']);
    const create = createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '5' }]);
    const held = await service.createCartReservation(create);
    if (held.kind !== 'ACTIVE') throw new Error('Expected ACTIVE result.');
    const releaseBase = {
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      warehouseId: fixture.warehouseId,
      referenceId: create.referenceId,
      cartVersion: create.cartVersion,
      correlationId: create.correlationId,
      causationId: create.causationId,
      actorId: create.actorId,
    };
    const releaseInput = {
      ...releaseBase,
      idempotencyKey: `release-${newId()}`,
      requestHash: 'release-1',
    };
    const release = await service.releaseCartReservation(releaseInput);
    expect(release.kind).toBe('RELEASED');
    expect(release.shortages).toEqual([]);
    expect(await service.releaseCartReservation(releaseInput)).toEqual(release);

    const competing = await service.createCartReservation(
      createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '5' }]),
    );
    expect(competing.kind).toBe('ACTIVE');
    const replay = await service.releaseCartReservation({
      ...releaseBase,
      idempotencyKey: `release-${newId()}`,
      requestHash: 'release-2',
    });
    expect(replay.kind).toBe('RELEASED');
    expect(replay.shortages).toHaveLength(1);
    expect(replay.shortages[0]?.available).toBe('0.00000000');

    await expect(
      service.createCartReservation({
        ...create,
        idempotencyKey: `recreate-${newId()}`,
        requestHash: 'recreate',
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.RESERVATION_NOT_AVAILABLE });
    expect(await effectCounts(held.reservation.reservationId)).toMatchObject({
      releaseLedger: '1',
    });
  });

  it('expires a due reservation exactly once across repeated bounded scans', async () => {
    const fixture = await createFixture(['5']);
    const held = await service.createCartReservation(
      createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '3' }]),
    );
    if (held.kind !== 'ACTIVE') throw new Error('Expected ACTIVE result.');
    await markDue(held.reservation.reservationId);

    expect(await service.expireDueReservations(10)).toEqual({ expired: 1 });
    expect(await service.expireDueReservations(10)).toEqual({ expired: 0 });
    const state = await repository.findReservationById(
      testdb.db,
      fixture.organizationId,
      held.reservation.reservationId,
    );
    expect(state?.status).toBe('EXPIRED');
    const position = await repository.findStockPositionById(
      testdb.db,
      fixture.organizationId,
      fixture.positionIds[0]!,
    );
    expect(position?.reserved).toBe('0.00000000');
    expect(await effectCounts(held.reservation.reservationId)).toEqual({
      releaseLedger: '1',
      expirationOutbox: '1',
    });
  });

  it('uses the same exactly-once transition for an expiration-versus-release race', async () => {
    const fixture = await createFixture(['5']);
    const input = createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '3' }]);
    const held = await service.createCartReservation(input);
    if (held.kind !== 'ACTIVE') throw new Error('Expected ACTIVE result.');
    await markDue(held.reservation.reservationId);

    const [, release] = await Promise.all([
      service.expireDueReservations(10),
      service.releaseCartReservation({
        organizationId: fixture.organizationId,
        branchId: fixture.branchId,
        warehouseId: fixture.warehouseId,
        referenceId: input.referenceId,
        cartVersion: input.cartVersion,
        idempotencyKey: `race-release-${newId()}`,
        requestHash: 'race-release',
        correlationId: input.correlationId,
        causationId: input.causationId,
        actorId: input.actorId,
      }),
    ]);

    expect(release.kind).toBe('EXPIRED');
    const position = await repository.findStockPositionById(
      testdb.db,
      fixture.organizationId,
      fixture.positionIds[0]!,
    );
    expect(position?.reserved).toBe('0.00000000');
    expect(await effectCounts(held.reservation.reservationId)).toEqual({
      releaseLedger: '1',
      expirationOutbox: '1',
    });
  });

  it('lazily expires on check and rejects consumed reservations', async () => {
    const fixture = await createFixture(['4']);
    const input = createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '2' }]);
    const held = await service.createCartReservation(input);
    if (held.kind !== 'ACTIVE') throw new Error('Expected ACTIVE result.');
    await markDue(held.reservation.reservationId);
    const checked = await service.checkCartReservation({
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      warehouseId: fixture.warehouseId,
      referenceId: input.referenceId,
      cartVersion: input.cartVersion,
      correlationId: input.correlationId,
      causationId: input.causationId,
      actorId: input.actorId,
    });
    expect(checked.kind).toBe('EXPIRED');

    await testdb.client.query(
      `UPDATE inventory.reservations SET status = 'CONSUMED' WHERE id = $1`,
      [held.reservation.reservationId],
    );
    await expect(
      service.checkCartReservation({
        organizationId: fixture.organizationId,
        branchId: fixture.branchId,
        warehouseId: fixture.warehouseId,
        referenceId: input.referenceId,
        cartVersion: input.cartVersion,
        correlationId: input.correlationId,
        causationId: input.causationId,
        actorId: input.actorId,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.RESERVATION_ALREADY_CONSUMED });
  });

  it('rejects cross-tenant, wrong-branch, wrong-warehouse, and wrong-reference access', async () => {
    const fixture = await createFixture(['5']);
    const foreign = await createFixture(['5']);
    await expect(
      service.createCartReservation(
        createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '1' }], {
          warehouseId: foreign.warehouseId,
        }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });
    await expect(
      service.createCartReservation(
        createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '1' }], {
          branchId: fixture.otherBranchId,
        }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });

    const input = createInput(fixture, [{ variantId: fixture.variantIds[0]!, quantity: '1' }]);
    const held = await service.createCartReservation(input);
    if (held.kind !== 'ACTIVE') throw new Error('Expected ACTIVE result.');
    const checkBase = {
      organizationId: fixture.organizationId,
      branchId: fixture.branchId,
      warehouseId: fixture.warehouseId,
      referenceId: input.referenceId,
      cartVersion: input.cartVersion,
      correlationId: input.correlationId,
      causationId: input.causationId,
      actorId: input.actorId,
    };
    await expect(
      service.checkCartReservation({ ...checkBase, warehouseId: fixture.otherWarehouseId }),
    ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });
    await expect(
      service.checkCartReservation({ ...checkBase, referenceId: newId() }),
    ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });
    await expect(
      service.checkCartReservation({ ...checkBase, organizationId: foreign.organizationId }),
    ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });

    expect(
      await repository.updateReservationStatus(
        testdb.db,
        foreign.organizationId,
        held.reservation.reservationId,
        'RELEASED',
        1,
      ),
    ).toBeNull();
    expect(
      await repository.findReservationItems(
        testdb.db,
        foreign.organizationId,
        held.reservation.reservationId,
      ),
    ).toEqual([]);
  });
});
