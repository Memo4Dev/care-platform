import { ERROR_CODES, isPlatformError } from '@commerce-platform/contracts';
import { POLICY_TYPES, newId } from '@commerce-platform/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';

import { OrganizationContractProvider } from './application/organization-contracts.provider';
import { OrganizationService } from './application/organization.service';
import { TenantOrganizationMutationAdapter } from './application/tenant-organization-mutation.adapter';
import {
  mapPersistenceError,
  OrganizationRepository,
} from './infrastructure/organization.repository';

/**
 * Integration coverage for the Organization context against REAL PostgreSQL
 * (docs/architecture/91-testing-architecture.md): transactions, unique
 * constraints, composite tenant constraints, optimistic concurrency,
 * transactional outbox and append-only policy history.
 */
describe('Organization context persistence', () => {
  let testdb: TestDatabase;
  let service: OrganizationService;
  let contracts: OrganizationContractProvider;
  let repository: OrganizationRepository;

  beforeAll(async () => {
    testdb = await createTestDatabase();
    service = new OrganizationService(testdb.db, new OrganizationRepository());
    contracts = new OrganizationContractProvider(testdb.db);
    repository = new OrganizationRepository();
  });

  afterAll(async () => {
    await testdb.teardown();
  });

  describe('migrations', () => {
    it('given a fresh database when migrations run then all organization/integration tables exist', async () => {
      const { rows } = await testdb.client.query<{ table_schema: string; table_name: string }>(
        `SELECT table_schema, table_name FROM information_schema.tables
         WHERE (table_schema = 'organization' OR table_schema = 'integration')
         ORDER BY table_schema, table_name`,
      );

      expect(rows).toEqual([
        { table_schema: 'integration', table_name: 'idempotency_outcomes' },
        { table_schema: 'integration', table_name: 'inbox' },
        { table_schema: 'integration', table_name: 'outbox' },
        { table_schema: 'organization', table_name: 'branches' },
        { table_schema: 'organization', table_name: 'organization_policies' },
        { table_schema: 'organization', table_name: 'organizations' },
        { table_schema: 'organization', table_name: 'warehouses' },
      ]);
    });
  });

  describe('branch code uniqueness (UNIQUE (organization_id, code))', () => {
    it('given a duplicate branch code written past the aggregate then the DB enforces branches_org_code_unique and the violation maps to VALIDATION_FAILED', async () => {
      const created = await service.createOrganization({ name: 'Unique Org' });
      const organizationId = created.organization.id;

      await service.createBranch({
        organizationId,
        code: 'BR-DUP',
        name: 'First',
      });

      // The repository's root-version CAS already serializes all aggregate
      // writes, so a duplicate can only reach the database from a writer that
      // bypasses the aggregate (manual maintenance, imports, bugs). Insert one
      // directly to prove the constraint holds regardless of the write path.
      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO organization.branches (id, organization_id, code, name)
           VALUES ($1, $2, $3, $4)`,
          [newId(), organizationId, 'BR-DUP', 'Second'],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23505'); // unique_violation
      expect(dbError?.constraint).toBe('branches_org_code_unique');

      // And the storage violation maps onto the platform error catalog.
      const mapped = mapPersistenceError(dbError, {
        action: 'insert',
        table: 'organization.branches',
        organizationId,
      });
      expect(isPlatformError(mapped)).toBe(true);
      const platformError = mapped as { code: string; details: Record<string, unknown> };
      expect(platformError.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(platformError.details).toMatchObject({
        constraint: 'branches_org_code_unique',
        field: 'code',
      });
    });

    it('given two aggregates loaded before either persists when both add DIFFERENT branches then the stale root version loses first with RESOURCE_VERSION_CONFLICT', async () => {
      const created = await service.createOrganization({ name: 'CAS Branches Org' });
      const organizationId = created.organization.id;

      const first = await repository.findOrganization(testdb.db, organizationId);
      const second = await repository.findOrganization(testdb.db, organizationId);

      first!.createBranch({ id: newId(), code: 'BR-A1', name: 'Winner branch' });
      await repository.save(testdb.db, first!);

      second!.createBranch({ id: newId(), code: 'BR-B1', name: 'Loser branch' });

      let error: unknown;
      try {
        await repository.save(testdb.db, second!);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.RESOURCE_VERSION_CONFLICT);

      const { rowCount } = await testdb.client.query(
        'SELECT 1 FROM organization.branches WHERE code = $1',
        ['BR-B1'],
      );
      expect(rowCount).toBe(0); // loser rolled back completely
    });

    it('given two different organizations when both use the same branch code then uniqueness does not leak across tenants', async () => {
      const orgA = await service.createOrganization({ name: 'Org A' });
      const orgB = await service.createOrganization({ name: 'Org B' });

      const branchA = await service.createBranch({
        organizationId: orgA.organization.id,
        branchId: newId(),
        code: 'BR-SHARED',
        name: 'A shared code',
      });
      const branchB = await service.createBranch({
        organizationId: orgB.organization.id,
        branchId: newId(),
        code: 'BR-SHARED',
        name: 'B reuses the code legally',
      });

      expect(branchA.eventsPersisted).toBe(1);
      expect(branchB.eventsPersisted).toBe(1);

      const { rowCount } = await testdb.client.query(
        'SELECT 1 FROM organization.branches WHERE code = $1',
        ['BR-SHARED'],
      );
      expect(rowCount).toBe(2);
    });
  });

  describe('composite tenant FK (TEN-003 backstop)', () => {
    it('given a warehouse row pointing at another organization branch when inserted directly then the composite FK rejects it with 23503', async () => {
      const orgA = await service.createOrganization({ name: 'Composite Org A' });
      const orgB = await service.createOrganization({ name: 'Composite Org B' });
      await service.createBranch({
        organizationId: orgA.organization.id,
        branchId: newId(),
        code: 'BR-A',
        name: 'Branch of A',
      });

      const { rows } = await testdb.client.query<{ id: string }>(
        'SELECT id FROM organization.branches WHERE organization_id = $1 LIMIT 1',
        [orgA.organization.id],
      );
      const branchOfAId = rows[0].id;

      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO organization.warehouses
             (id, organization_id, branch_id, code, name)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            newId(),
            orgB.organization.id, // WRONG tenant on purpose
            branchOfAId, // ...referencing a branch owned by Org A
            'WH-EVIL',
            'Cross-tenant injection attempt',
          ],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23503'); // foreign_key_violation
      expect(dbError?.constraint).toBe('warehouses_branch_tenant_fk');
    });

    it('given a warehouse correctly bound to its own organization branch when inserted then the same composite FK accepts it', async () => {
      const org = await service.createOrganization({ name: 'Composite Happy Org' });
      const branchId = newId();
      await service.createBranch({
        organizationId: org.organization.id,
        branchId,
        code: 'BR-OK',
        name: 'Own Branch',
      });
      const { rows } = await testdb.client.query<{ id: string }>(
        'SELECT id FROM organization.branches WHERE id = $1',
        [branchId],
      );

      // Same-tenant pairing must pass the composite FK silently.
      await testdb.client.query(
        `INSERT INTO organization.warehouses (id, organization_id, branch_id, code, name)
         VALUES ($1, $2, $3, $4, $5)`,
        [newId(), org.organization.id, rows[0].id, 'WH-GOOD', 'Legitimate row'],
      );

      const { rowCount } = await testdb.client.query(
        'SELECT 1 FROM organization.warehouses WHERE organization_id = $1',
        [org.organization.id],
      );
      expect(rowCount).toBe(1);
    });
  });

  describe('optimistic concurrency', () => {
    it('given two aggregates loaded from the same version when both are saved sequentially then the second save raises RESOURCE_VERSION_CONFLICT', async () => {
      const created = await service.createOrganization({ name: 'CAS Org' });
      const organizationId = created.organization.id;

      const branchId = newId();
      await service.createBranch({
        organizationId,
        branchId,
        code: 'BR-CAS',
        name: 'CAS Branch',
      });

      const first = await repository.findOrganization(testdb.db, organizationId);
      const second = await repository.findOrganization(testdb.db, organizationId);
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();

      // Winner: an always-allowed command that advances the root version.
      first!.setPolicy({ policyType: 'OFFLINE', value: { enabled: false } });
      const savedEvents = await repository.save(testdb.db, first!);
      expect(savedEvents).toBe(1);

      // Loser: built on the STALE read (version 2 in memory, 3 in the DB).
      // setPolicy is not state-guarded, so the conflict must surface from the
      // optimistic-concurrency gate, not from a transition guard.
      second!.setPolicy({ policyType: 'OFFLINE', value: { enabled: true } });

      let error: unknown;
      try {
        await repository.save(testdb.db, second!);
      } catch (caught) {
        error = caught;
      }

      expect(isPlatformError(error)).toBe(true);
      const platformError = error as { code: string; details?: Record<string, unknown> };
      expect(platformError.code).toBe(ERROR_CODES.RESOURCE_VERSION_CONFLICT);
      expect(platformError.details).toMatchObject({
        organizationId,
        expectedVersion: 2,
      });

      // The losing write must have rolled back entirely — no outbox residue
      // and the winning policy value stays intact.
      const { rows } = await testdb.client.query<{ count: string; value: unknown }>(
        `SELECT count(*) AS count,
                (SELECT value_json FROM organization.organization_policies
                 WHERE organization_id = $1 AND policy_type = 'OFFLINE') AS value
         FROM integration.outbox
           WHERE aggregate_id = $1 AND payload->>'eventType' = 'organization.organization-policy-changed'`,
        [organizationId],
      );
      expect(rows[0].count).toBe('1');
      expect(rows[0].value).toEqual({ enabled: false });
    });
  });

  describe('transactional outbox', () => {
    it('given three commands when executed then exactly one outbox row is appended per command with ordered events and payloads', async () => {
      const org = await service.createOrganization({ name: 'Outbox Org' });
      const organizationId = org.organization.id;

      await service.createBranch({
        organizationId,
        branchId: newId(),
        code: 'BR-OB',
        name: 'Outbox Branch',
      });
      await service.setPolicy({
        organizationId,
        policyType: 'RETURN',
        value: { enabled: true },
      });

      const { rows } = await testdb.client.query<{
        aggregate_type: string;
        event_type: string;
        payload: Record<string, unknown>;
        occurred_at: Date;
        correlation_id: string | null;
      }>(
        // id is the final tiebreak: timestamps share clock precision, while
        // UUIDv7 ids are time-ordered and unique, making the order total.
        `SELECT aggregate_type, event_type, payload, occurred_at, correlation_id
         FROM integration.outbox WHERE aggregate_id = $1 ORDER BY occurred_at, created_at, id`,
        [organizationId],
      );

      expect(rows.map((row) => row.event_type)).toEqual([
        'organization.organization-created',
        'organization.branch-created',
        'organization.organization-policy-changed',
      ]);
      expect(rows.every((row) => row.aggregate_type === 'Organization')).toBe(true);
      expect(JSON.parse(JSON.stringify(rows[0].payload))).toMatchObject({
        eventScope: 'TENANT',
        organizationId,
        payload: { organizationId, status: 'ACTIVE' },
      });
      expect(rows[0].payload.payload).not.toHaveProperty('name');
      expect(rows[1].payload.payload).not.toHaveProperty('name');
      expect(rows[2].payload.payload).not.toHaveProperty('value');
      expect(JSON.parse(JSON.stringify(rows[2].payload))).toMatchObject({
        eventScope: 'TENANT',
        organizationId,
        payload: { policyType: 'RETURN', policyVersion: 1 },
      });
    });

    it('given an unchanged aggregate when saved again then zero events are appended (no CAS bump, no outbox noise)', async () => {
      const org = await service.createOrganization({ name: 'Quiet Org' });
      const organizationId = org.organization.id;

      const loaded = await repository.findOrganization(testdb.db, organizationId);
      const eventsPersisted = await repository.save(testdb.db, loaded!);

      expect(eventsPersisted).toBe(0);

      const { rows } = await testdb.client.query<{ count: string }>(
        'SELECT count(*) AS count FROM integration.outbox WHERE aggregate_id = $1',
        [organizationId],
      );
      expect(rows[0].count).toBe('1'); // only the original OrganizationCreated
    });
  });

  describe('tenant command idempotency adapter', () => {
    it('claims, completes and replays branch mutations with state and outbox in one local transaction', async () => {
      const organization = await service.createOrganization({ name: 'HTTP command adapter org' });
      const input = {
        organizationId: organization.organization.id,
        idempotencyScope: `ORGANIZATION_USER:test:${organization.organization.id}:branches`,
        idempotencyKey: newId(),
        body: { code: 'HTTP-BRANCH', name: 'HTTP Branch', priority: 4 },
      };
      const firstAdapter = new TenantOrganizationMutationAdapter(testdb.db, service);
      const secondAdapter = new TenantOrganizationMutationAdapter(testdb.db, service);

      const first = await firstAdapter.createBranch(input);
      const replay = await secondAdapter.createBranch(input);

      expect(replay).toEqual(first);
      const { rows } = await testdb.client.query<{ status: string; response_json: unknown }>(
        `SELECT status, response_json FROM integration.idempotency_outcomes
         WHERE scope = $1 AND idempotency_key = $2`,
        [input.idempotencyScope, input.idempotencyKey],
      );
      expect(rows).toEqual([{ status: 'COMPLETED', response_json: first }]);

      await expect(
        secondAdapter.createBranch({ ...input, body: { ...input.body, name: 'Changed' } }),
      ).rejects.toMatchObject({ code: ERROR_CODES.IDEMPOTENCY_CONFLICT });
      const outbox = await testdb.client.query<{ count: string }>(
        `SELECT count(*) AS count FROM integration.outbox
         WHERE aggregate_id = $1 AND event_type = 'organization.branch-created'`,
        [organization.organization.id],
      );
      expect(outbox.rows[0].count).toBe('1');
    });

    it('rolls back the claim with failed business state and serializes concurrent/new adapter instances', async () => {
      const organization = await service.createOrganization({ name: 'Adapter concurrency org' });
      const scope = `ORGANIZATION_USER:test:${organization.organization.id}:warehouses`;
      const key = newId();
      const firstAdapter = new TenantOrganizationMutationAdapter(testdb.db, service);
      const secondAdapter = new TenantOrganizationMutationAdapter(testdb.db, service);

      await expect(
        firstAdapter.createWarehouse({
          organizationId: organization.organization.id,
          idempotencyScope: scope,
          idempotencyKey: key,
          body: { branchId: newId(), code: 'ROLLBACK', name: 'Rejected warehouse' },
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.RESOURCE_NOT_FOUND });
      expect(
        await testdb.client.query(
          'SELECT 1 FROM integration.idempotency_outcomes WHERE scope = $1 AND idempotency_key = $2',
          [scope, key],
        ),
      ).toMatchObject({ rowCount: 0 });

      const branchId = newId();
      await service.createBranch({
        organizationId: organization.organization.id,
        branchId,
        code: 'CONCURRENT-BRANCH',
        name: 'Concurrent branch',
      });
      const command = {
        organizationId: organization.organization.id,
        idempotencyScope: scope,
        idempotencyKey: key,
        body: { branchId, code: 'CONCURRENT', name: 'Concurrent warehouse' },
      };
      const [first, replay] = await Promise.all([
        firstAdapter.createWarehouse(command),
        secondAdapter.createWarehouse(command),
      ]);
      expect(replay).toEqual(first);
      const count = await testdb.client.query<{ count: string }>(
        'SELECT count(*) AS count FROM organization.warehouses WHERE organization_id = $1 AND code = $2',
        [organization.organization.id, 'CONCURRENT'],
      );
      expect(count.rows[0].count).toBe('1');
    });
  });

  describe('append-only policy history', () => {
    it('given repeated SetPolicy commands when persisted then every change appends one immutable row and latest lookup wins by version', async () => {
      const org = await service.createOrganization({ name: 'Policy Org' });
      const organizationId = org.organization.id;

      await service.setPolicy({
        organizationId,
        policyType: 'RETURN',
        value: { enabled: true, windowDays: 14 },
      });
      await service.setPolicy({
        organizationId,
        policyType: 'RETURN',
        value: { enabled: false },
      });
      await service.setPolicy({
        organizationId,
        policyType: 'CREDIT',
        value: { enabled: false },
      });

      const { rows } = await testdb.client.query<{
        policy_type: string;
        version: number;
        value_json: unknown;
      }>(
        `SELECT policy_type, version, value_json FROM organization.organization_policies
         WHERE organization_id = $1 ORDER BY version`,
        [organizationId],
      );

      expect(rows).toEqual([
        { policy_type: 'RETURN', version: 1, value_json: { enabled: true, windowDays: 14 } },
        { policy_type: 'RETURN', version: 2, value_json: { enabled: false } },
        { policy_type: 'CREDIT', version: 3, value_json: { enabled: false } },
      ]);

      // Latest stored lookup uses the (org, type, version DESC) index.
      const returnView = await contracts.getOrganizationPolicy(organizationId, 'RETURN');
      expect(returnView).toMatchObject({
        organizationId,
        policyType: 'RETURN',
        value: { enabled: false },
        version: 2,
        source: 'stored',
      });
    });

    it('given a duplicate (organization, version) written past the aggregate then the DB enforces organization_policies_org_version_unique and the violation maps to VALIDATION_FAILED', async () => {
      const org = await service.createOrganization({ name: 'Policy Constraint Org' });
      const organizationId = org.organization.id;

      await service.setPolicy({
        organizationId,
        policyType: 'RETURN',
        value: { enabled: true },
      });

      // Mirror of the branch-code proof: the domain assigns per-organization
      // monotonic versions, but a writer that bypasses the aggregate (manual
      // maintenance, imports, bugs) must still be rejected by storage.
      let dbError: { code?: string; constraint?: string } | null = null;
      try {
        await testdb.client.query(
          `INSERT INTO organization.organization_policies (id, organization_id, policy_type, value_json, version)
           VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [newId(), organizationId, 'CREDIT', JSON.stringify({ enabled: false }), 1],
        );
      } catch (caught) {
        dbError = caught as { code?: string; constraint?: string };
      }

      expect(dbError).not.toBeNull();
      expect(dbError?.code).toBe('23505'); // unique_violation
      expect(dbError?.constraint).toBe('organization_policies_org_version_unique');

      // And the storage violation maps onto the platform error catalog.
      const mapped = mapPersistenceError(dbError, {
        action: 'insert',
        table: 'organization.organization_policies',
        organizationId,
      });
      expect(isPlatformError(mapped)).toBe(true);
      const platformError = mapped as { code: string; details: Record<string, unknown> };
      expect(platformError.code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect(platformError.details).toMatchObject({
        constraint: 'organization_policies_org_version_unique',
        field: 'version',
      });
    });

    it('given a policy type never set when queried then the provisional default is returned with version 0 and source=default', async () => {
      const org = await service.createOrganization({ name: 'Default Policy Org' });

      const view = await contracts.getOrganizationPolicy(org.organization.id, 'ORDER_APPROVAL');

      expect(view.source).toBe('default');
      expect(view.version).toBe(0);
      expect(view.value).toEqual({ required: false });
    });

    it('given every catalog policy type when defaulted then a default exists for each (exhaustiveness guard)', async () => {
      const org = await service.createOrganization({ name: 'Exhaustive Policy Org' });

      for (const policyType of POLICY_TYPES) {
        const view = await contracts.getOrganizationPolicy(org.organization.id, policyType);
        expect(view.source).toBe('default');
        expect(typeof view.value).toBe('object');
      }
    });
  });

  describe('tenant-scoped contract reads (Layer 2/Layer 4 isolation)', () => {
    it('given branches of two organizations when reading across tenants then getBranch/getWarehouse return null and getBranchPriority raises RESOURCE_NOT_FOUND', async () => {
      const orgA = await service.createOrganization({ name: 'Isolation A' });
      const orgB = await service.createOrganization({ name: 'Isolation B' });

      const branchAId = newId();
      await service.createBranch({
        organizationId: orgA.organization.id,
        branchId: branchAId,
        code: 'BR-ISO',
        name: 'Branch A',
        priority: 7,
      });

      // Cross-tenant reads return "not there", never tenant-B data.
      await expect(contracts.getBranch(orgB.organization.id, branchAId)).resolves.toBeNull();
      await expect(contracts.getWarehouse(orgB.organization.id, branchAId)).resolves.toBeNull();

      let error: unknown;
      try {
        await contracts.getBranchPriority(orgB.organization.id, branchAId);
      } catch (caught) {
        error = caught;
      }
      expect(isPlatformError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(ERROR_CODES.RESOURCE_NOT_FOUND);

      // Same-tenant reads work and carry the priority.
      await expect(contracts.getBranchPriority(orgA.organization.id, branchAId)).resolves.toBe(7);
    });
  });

  describe('aggregate round-trip', () => {
    it('given a fully populated aggregate when saved and reloaded then state, versions and policies survive persistence', async () => {
      const org = await service.createOrganization({ name: 'Roundtrip Org' });
      const organizationId = org.organization.id;

      const branchId = newId();
      const warehouseId = newId();
      await service.createBranch({
        organizationId,
        branchId,
        code: 'BR-RT',
        name: 'Roundtrip Branch',
        priority: 3,
      });
      await service.createWarehouse({
        organizationId,
        branchId,
        warehouseId,
        code: 'WH-RT',
        name: 'Roundtrip Warehouse',
      });
      await service.deactivateWarehouse({ organizationId, warehouseId });
      await service.suspendOrganization({ organizationId });

      const loaded = await repository.findOrganization(testdb.db, organizationId);
      expect(loaded).not.toBeNull();
      expect(loaded!.status).toBe('SUSPENDED');
      expect(loaded!.name).toBe('Roundtrip Org');

      const branchesLoaded = loaded!.listBranches();
      expect(branchesLoaded).toHaveLength(1);
      expect(branchesLoaded[0]).toMatchObject({
        id: branchId,
        code: 'BR-RT',
        priority: 3,
        isActive: true,
      });

      const warehousesLoaded = loaded!.listWarehouses();
      expect(warehousesLoaded).toHaveLength(1);
      expect(warehousesLoaded[0]).toMatchObject({
        id: warehouseId,
        code: 'WH-RT',
        isActive: false,
      });

      // Rehydrated aggregate continues the policy sequence without collision.
      loaded!.setPolicy({ policyType: 'DELIVERY', value: { enabled: true } });
      const events = await repository.save(testdb.db, loaded!);
      expect(events).toBe(1);

      const view = await contracts.getOrganizationPolicy(organizationId, 'DELIVERY');
      expect(view).toMatchObject({ source: 'stored', version: 1, value: { enabled: true } });
    });
  });
});
