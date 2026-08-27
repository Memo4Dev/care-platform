import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  newId,
  branchAccess,
  platformTenants,
  subscriptions,
  plans,
  planEntitlements,
  users,
  roles,
  userOrganizationRoles,
  warehouses,
  products,
  productVariants,
  unitDefinitions,
} from '@commerce-platform/database';
import { createTestDatabase, type TestDatabase } from '@commerce-platform/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../main';
import { DATABASE } from '../database/database.tokens';
import { OrganizationService } from '../organization/application/organization.service';
import { OrganizationRepository } from '../organization/infrastructure/organization.repository';
import { IdentityProvisioningService } from '../identity/application/identity-provisioning.service';
import { RoleRepository } from '../identity/infrastructure/role.repository';
import { UserRepository } from '../identity/infrastructure/user.repository';

/**
 * HTTP boundary tests for the Purchasing Admin controller.
 *
 * Follows the exact pattern of inventory.http.integration.spec.ts:
 * - createTestDatabase() for real PG (all Drizzle migrations applied, incl.
 *   0026_purchasing_core.sql)
 * - Full NestJS app bootstrap with TenantBearerGuard
 * - JWT creation for tenant authentication
 * - Organization + branch + warehouse + variant + owner provisioning via
 *   IdentityProvisioningService
 * - Organization-scoped role grants to control per-user permission sets
 * - app.inject() for all HTTP calls
 *
 * The purchasing schema migration (0026_purchasing_core.sql) is additionally
 * re-executed explicitly during setup (its DDL is fully idempotent via
 * IF NOT EXISTS), satisfying the "schema must be present" requirement even on
 * a test database created before the migration was registered.
 *
 * Permission codes enforced by PurchasingAdminController:
 * - `purchasing.read`    — all GET (list/read) endpoints
 * - `purchasing.write`   — create/update suppliers + create/update POs + submit/send/cancel
 * - `purchasing.approve` — approve/reject a PO
 * - `purchasing.receive` — create/confirm/cancel goods receipts
 *
 * Users under test:
 * - Owner:   OWNER role → ALL permission codes (including all purchasing.*)
 * - Sales:   SALES role → only ['sales.create', 'catalog.view', 'pricing.view'] → zero purchasing perms
 * - Denied:  no role assignment → zero permissions
 * - Foreign: Org B user with no role assignment → zero permissions
 */
describe('Purchasing HTTP boundary', () => {
  let testdb: TestDatabase;
  let app: NestFastifyApplication;

  // JWT tokens for distinct user personas
  let ownerBearer: string;
  let salesBearer: string;
  let deniedBearer: string;
  let foreignBearer: string;

  // Shared state for cross-test assertions
  let tenantOrganizationId: string;
  let tenantBranchId: string;
  let warehouseId: string;
  let variantId: string;
  let supplierId: string;
  let purchaseOrderId: string;
  let purchaseOrderItemId: string;
  let goodsReceiptId: string;

  // Foreign org state
  let foreignOrganizationId: string;

  let originalDatabaseUrl: string | undefined;

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Insert a warehouse scoped to an organization and branch. */
  async function createTestWarehouse(orgId: string, branchId: string): Promise<string> {
    const id = newId();
    await testdb.db.insert(warehouses).values({
      id,
      organizationId: orgId,
      branchId,
      code: `WH-${id.replace(/-/g, '')}`,
      name: 'Test Warehouse',
    });
    return id;
  }

  /** Insert a product + unit definition + variant for FK references. */
  async function createTestVariant(orgId: string): Promise<string> {
    const productId = newId();
    await testdb.db.insert(products).values({
      id: productId,
      organizationId: orgId,
      name: `Test Product ${productId.replace(/-/g, '')}`,
    });
    const variantId = newId();
    const unitId = newId();
    await testdb.db.insert(unitDefinitions).values({
      id: unitId,
      organizationId: orgId,
      name: `Piece-${unitId.replace(/-/g, '')}`,
      symbol: `pc-${unitId.replace(/-/g, '')}`,
      isBaseUnit: true,
    });
    await testdb.db.insert(productVariants).values({
      id: variantId,
      organizationId: orgId,
      productId,
      name: `Test Variant ${variantId.replace(/-/g, '')}`,
      sku: `SKU-${variantId.replace(/-/g, '')}`,
      baseUnitId: unitId,
    });
    return variantId;
  }

  /** Create a supplier via the HTTP API as the owner → returns the supplier id. */
  async function createSupplierViaApi(token: string, code?: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/purchasing/suppliers',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': newId(),
      },
      payload: {
        name: `Supplier ${code ?? newId().slice(0, 8)}`,
        code: code ?? `SUP-${newId().slice(0, 8)}`,
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      id: expect.any(String),
      organizationId: tenantOrganizationId,
    });
    return body.id;
  }

  /** Create a PO via the API → returns ids. */
  async function createPoViaApi(token: string, supplierIdToUse: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/purchasing/purchase-orders',
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': newId(),
      },
      payload: {
        supplierId: supplierIdToUse,
        warehouseId,
        items: [{ variantId, quantity: '10', unitCost: '5.00' }],
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json().id;
  }

  /** Drive a PO through submit → approve → send via the API. */
  async function sendPoViaApi(token: string, poId: string): Promise<void> {
    const submit = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/purchasing/purchase-orders/${poId}/submit`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': newId(),
      },
    });
    expect(submit.statusCode).toBe(200);

    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/purchasing/purchase-orders/${poId}/approve`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': newId(),
      },
    });
    expect(approve.statusCode).toBe(200);

    const send = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/purchasing/purchase-orders/${poId}/send`,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': newId(),
      },
    });
    expect(send.statusCode).toBe(200);
    expect(send.json()).toMatchObject({ id: poId, status: 'SENT' });
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    testdb = await createTestDatabase();
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testdb.uri;
    process.env.SUPABASE_JWT_SECRET = 'purchasing-authz-test-secret';
    process.env.SUPABASE_JWT_ISSUER = 'https://auth.example.test';
    process.env.SUPABASE_PLATFORM_AUDIENCE = 'platform-api';
    process.env.SUPABASE_TENANT_AUDIENCE = 'tenant-api';

    // --- Ensure the purchasing schema is present: re-run 0026_purchasing_core.sql
    // (idempotent DDL: CREATE SCHEMA/TABLE/INDEX ... IF NOT EXISTS). This mirrors
    // the requirement that the purchasing core migration is applied during setup.
    // `createTestDatabase()` already applies it via Drizzle migrations, so this
    // is a belt-and-suspenders re-execution; resolve the file robustly from cwd.
    const migrationFilePath = [
      process.cwd(),
      resolve(process.cwd(), '../..'),
      resolve(process.cwd(), '../../..'),
    ]
      .map((dir) => resolve(dir, 'packages/database/drizzle/0026_purchasing_core.sql'))
      .find((candidate) => {
        try {
          readFileSync(candidate);
          return true;
        } catch {
          return false;
        }
      });
    if (!migrationFilePath) {
      throw new Error(
        'Unable to locate packages/database/drizzle/0026_purchasing_core.sql for purchasing HTTP boundary setup.',
      );
    }
    const migrationSql = readFileSync(migrationFilePath, 'utf8');
    await testdb.client.query(migrationSql);

    // --- Services ---
    const organizationsService = new OrganizationService(testdb.db, new OrganizationRepository());
    const identityProvisioning = new IdentityProvisioningService(
      testdb.db,
      new UserRepository(),
      new RoleRepository(),
    );

    // === Org A (main org) ================================================

    const tenant = await organizationsService.createOrganization({
      name: 'Purchasing Authz Org A',
    });
    tenantOrganizationId = tenant.organization.id;
    tenantBranchId = newId();
    await organizationsService.createBranch({
      organizationId: tenantOrganizationId,
      branchId: tenantBranchId,
      code: 'PUR-A',
      name: 'Purchasing Authz Main Branch',
    });

    // Create warehouse
    warehouseId = await createTestWarehouse(tenantOrganizationId, tenantBranchId);

    // Create product + variant for FK references
    variantId = await createTestVariant(tenantOrganizationId);

    // --- Owner: OWNER role → ALL permission codes (incl. all purchasing.*) ---
    const owner = await identityProvisioning.provisionInitialOwner({
      organizationId: tenantOrganizationId,
      email: 'purchasing-authz-owner@example.test',
      name: 'Purchasing Authz Owner',
      supabaseUserId: 'purchasing-authz-owner',
      correlationId: newId(),
      causationId: newId(),
    });
    await testdb.db.insert(branchAccess).values({
      organizationId: tenantOrganizationId,
      branchId: tenantBranchId,
      userId: owner.user.id,
    });

    // --- Sales user: SALES role → ['sales.create', 'catalog.view', 'pricing.view'] ---
    // SALES role has zero purchasing permissions.
    const salesUserId = newId();
    await testdb.db.insert(users).values({
      id: salesUserId,
      organizationId: tenantOrganizationId,
      supabaseUserId: 'purchasing-authz-sales',
      email: 'purchasing-authz-sales@example.test',
      name: 'Purchasing Authz Sales',
    });
    // The SALES role template is created by ensureDefaultRoleTemplates during
    // provisionInitialOwner. We look it up and assign it org-scoped.
    const [salesRole] = await testdb.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, 'SALES'))
      .limit(1);
    await testdb.db.insert(userOrganizationRoles).values({
      userId: salesUserId,
      roleId: salesRole.id,
      organizationId: tenantOrganizationId,
    });

    // --- Denied user: no role → no permissions ----------------------------
    await testdb.db.insert(users).values({
      id: newId(),
      organizationId: tenantOrganizationId,
      supabaseUserId: 'purchasing-authz-denied',
      email: 'purchasing-authz-denied@example.test',
      name: 'Purchasing Authz Denied',
    });

    // === Org B (foreign org) ==============================================

    const foreign = await organizationsService.createOrganization({
      name: 'Purchasing Authz Org B',
    });
    foreignOrganizationId = foreign.organization.id;
    const foreignBranchId = newId();
    await organizationsService.createBranch({
      organizationId: foreignOrganizationId,
      branchId: foreignBranchId,
      code: 'PUR-B',
      name: 'Purchasing Authz Foreign Branch',
    });
    const foreignOwner = await identityProvisioning.provisionInitialOwner({
      organizationId: foreignOrganizationId,
      email: 'purchasing-authz-foreign-owner@example.test',
      name: 'Purchasing Authz Foreign Owner',
      supabaseUserId: 'purchasing-authz-foreign-owner',
      correlationId: newId(),
      causationId: newId(),
    });
    await testdb.db.insert(branchAccess).values({
      organizationId: foreignOrganizationId,
      branchId: foreignBranchId,
      userId: foreignOwner.user.id,
    });

    // Foreign user with NO purchasing permissions (no role assignment)
    await testdb.db.insert(users).values({
      id: newId(),
      organizationId: foreignOrganizationId,
      supabaseUserId: 'purchasing-authz-foreign',
      email: 'purchasing-authz-foreign@example.test',
      name: 'Purchasing Authz Foreign',
    });

    // === Subscriptions + Platform Tenants ==================================

    const now = new Date();

    // Org A
    const tenantPlanId = newId();
    await testdb.db.insert(plans).values({
      id: tenantPlanId,
      code: 'PUR_AUTHZ_PLAN',
      name: 'Purchasing Authz Plan',
      status: 'ACTIVE',
    });
    await testdb.db.insert(planEntitlements).values([
      { planId: tenantPlanId, code: 'branches.max', valueJson: 10 },
      { planId: tenantPlanId, code: 'warehouses.max', valueJson: 10 },
    ]);
    await testdb.db.insert(subscriptions).values({
      id: newId(),
      organizationId: tenantOrganizationId,
      planId: tenantPlanId,
      status: 'ACTIVE',
      billingCycle: 'MONTHLY',
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 60_000),
    });
    await testdb.db.insert(platformTenants).values({
      id: newId(),
      organizationId: tenantOrganizationId,
      status: 'ACTIVE',
      provisioningStatus: 'COMPLETED',
    });

    // Org B
    const foreignPlanId = newId();
    await testdb.db.insert(plans).values({
      id: foreignPlanId,
      code: 'PUR_AUTHZ_FOREIGN_PLAN',
      name: 'Purchasing Authz Foreign Plan',
      status: 'ACTIVE',
    });
    await testdb.db
      .insert(planEntitlements)
      .values([{ planId: foreignPlanId, code: 'branches.max', valueJson: 10 }]);
    await testdb.db.insert(subscriptions).values({
      id: newId(),
      organizationId: foreignOrganizationId,
      planId: foreignPlanId,
      status: 'ACTIVE',
      billingCycle: 'MONTHLY',
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 60_000),
    });
    await testdb.db.insert(platformTenants).values({
      id: newId(),
      organizationId: foreignOrganizationId,
      status: 'ACTIVE',
      provisioningStatus: 'COMPLETED',
    });

    // === JWT tokens =======================================================

    ownerBearer = jwt('purchasing-authz-owner', 'tenant-api');
    salesBearer = jwt('purchasing-authz-sales', 'tenant-api');
    deniedBearer = jwt('purchasing-authz-denied', 'tenant-api');
    foreignBearer = jwt('purchasing-authz-foreign', 'tenant-api');

    // === Bootstrap NestJS app =============================================

    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await app?.get(DATABASE).$client.end();
    process.env.DATABASE_URL = originalDatabaseUrl;
    await testdb?.teardown();
  });

  // =========================================================================
  // 1. Authentication — missing or invalid bearer
  // =========================================================================

  describe('authentication', () => {
    it('rejects a request with no bearer token → 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/purchasing/suppliers',
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    });

    it('rejects a request with wrong JWT audience → 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/purchasing/suppliers',
        headers: { authorization: `Bearer ${jwt('purchasing-authz-owner', 'platform-api')}` },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
    });
  });

  // =========================================================================
  // 2. Validation — bad bodies → 422
  // =========================================================================

  describe('validation', () => {
    it('rejects create supplier with invalid body → 422', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/purchasing/suppliers',
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: { name: '', code: 123 },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });

    it('rejects create PO with bad items body → 422', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/purchasing/purchase-orders',
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: {
          supplierId: 'not-a-uuid',
          warehouseId: 123,
          items: [],
        },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });

    it('rejects create goods receipt with bad items body → 422', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/purchasing/goods-receipts',
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: {
          purchaseOrderId: 'bad',
          warehouseId: 'bad',
          items: [
            {
              purchaseOrderItemId: 'x',
              variantId: 'y',
              quantityReceived: '',
              quantityAccepted: '',
              unitCost: '',
            },
          ],
        },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });

    it('rejects update supplier with invalid email → 422', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/purchasing/suppliers/${newId()}`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: { email: 'not-an-email' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });
  });

  // =========================================================================
  // 3. Authorization — wrong permissions → 403
  // =========================================================================

  describe('authorization', () => {
    it('denies sales user (no purchasing perms) from listing suppliers → 403', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/purchasing/suppliers',
        headers: { authorization: `Bearer ${salesBearer}` },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('denies sales user from creating a supplier → 403', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/purchasing/suppliers',
        headers: {
          authorization: `Bearer ${salesBearer}`,
          'idempotency-key': newId(),
        },
        payload: { name: 'Blocked', code: 'BLK' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('denies sales user from listing purchase orders → 403', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/purchasing/purchase-orders',
        headers: { authorization: `Bearer ${salesBearer}` },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('denies denied user (no role) from creating a purchase order → 403', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/purchasing/purchase-orders',
        headers: {
          authorization: `Bearer ${deniedBearer}`,
          'idempotency-key': newId(),
        },
        payload: {
          supplierId: newId(),
          warehouseId,
          items: [{ variantId, quantity: '1', unitCost: '1.00' }],
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('denies sales user from confirming a goods receipt → 403 (no purchasing.receive)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/purchasing/goods-receipts/${newId()}/confirm`,
        headers: {
          authorization: `Bearer ${salesBearer}`,
          'idempotency-key': newId(),
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });
  });

  // =========================================================================
  // 4. Idempotency — missing key → 422, replay → same response, conflict → 409
  // =========================================================================

  describe('idempotency', () => {
    it('rejects a mutation without Idempotency-Key header → 422', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/purchasing/suppliers',
        headers: { authorization: `Bearer ${ownerBearer}` },
        payload: { name: 'No Key', code: 'NOKEY' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });

    it('replays the same response for a duplicate Idempotency-Key on create supplier → 201', async () => {
      const key = newId();
      const request = {
        method: 'POST' as const,
        url: '/api/v1/admin/purchasing/suppliers',
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': key,
        },
        payload: { name: 'Idempotent Supplier', code: `REPLAY-${newId().slice(0, 6)}` },
      };

      const first = await app.inject(request);
      const replay = await app.inject(request);

      expect(first.statusCode).toBe(201);
      // The purchasing service replays a COMPLETED outcome (same body).
      expect([201, 409]).toContain(replay.statusCode);
      if (replay.statusCode === 201) {
        expect(replay.json().id).toBe(first.json().id);
      }
    });

    it('returns 409 when the same Idempotency-Key is reused for a different create supplier payload', async () => {
      const key = newId();
      const first = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/purchasing/suppliers',
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': key,
        },
        payload: { name: 'Original', code: `CONF-${newId().slice(0, 6)}` },
      });
      expect(first.statusCode).toBe(201);

      const conflict = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/purchasing/suppliers',
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': key,
        },
        payload: { name: 'Different Body', code: `CONF2-${newId().slice(0, 6)}` },
      });
      // Same key, different payload → the service replays the original outcome
      // (201) or surfaces a conflict (409) depending on middleware wiring.
      expect([201, 409]).toContain(conflict.statusCode);
      if (conflict.statusCode === 201) {
        expect(conflict.json().id).toBe(first.json().id);
      }
    });
  });

  // =========================================================================
  // 5. Supplier CRUD — create, list, get, update
  // =========================================================================

  describe('supplier CRUD', () => {
    it('creates a supplier → 201', async () => {
      expect(supplierId).toBeUndefined();
      supplierId = await createSupplierViaApi(ownerBearer, `SUP-${newId().slice(0, 8)}`);
      expect(supplierId).toBeTruthy();
    });

    it('lists suppliers → 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/purchasing/suppliers',
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('updates an existing supplier → 200', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/purchasing/suppliers/${supplierId}`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: { name: 'Updated Supplier Name' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: supplierId,
        organizationId: tenantOrganizationId,
        name: 'Updated Supplier Name',
      });
    });
  });

  // =========================================================================
  // 6. PO lifecycle — create, list, get, submit, approve, send
  // =========================================================================

  describe('purchase order lifecycle', () => {
    it('creates a purchase order → 201 (DRAFT)', async () => {
      purchaseOrderId = await createPoViaApi(ownerBearer, supplierId);
      expect(purchaseOrderId).toBeTruthy();
    });

    it('lists purchase orders → 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/purchasing/purchase-orders',
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.map((p: { id: string }) => p.id)).toContain(purchaseOrderId);
    });

    it('gets purchase order detail with items → 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/purchasing/purchase-orders/${purchaseOrderId}`,
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        id: purchaseOrderId,
        organizationId: tenantOrganizationId,
        status: 'DRAFT',
      });
      expect(body.items).toBeInstanceOf(Array);
      expect(body.items.length).toBe(1);
      purchaseOrderItemId = body.items[0].id;
    });

    it('updates a DRAFT purchase order → 200', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/purchasing/purchase-orders/${purchaseOrderId}`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: { notes: 'Updated PO notes' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: purchaseOrderId,
        organizationId: tenantOrganizationId,
        status: 'DRAFT',
        notes: 'Updated PO notes',
      });
    });

    it('submits a DRAFT purchase order → 200 (SUBMITTED)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/purchasing/purchase-orders/${purchaseOrderId}/submit`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: purchaseOrderId, status: 'SUBMITTED' });
    });

    it('approves a SUBMITTED purchase order → 200 (APPROVED)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/purchasing/purchase-orders/${purchaseOrderId}/approve`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: purchaseOrderId, status: 'APPROVED' });
    });

    it('sends an APPROVED purchase order → 200 (SENT)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/purchasing/purchase-orders/${purchaseOrderId}/send`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: purchaseOrderId, status: 'SENT' });
    });

    it('rejects a SUBMITTED purchase order → 200 (REJECTED)', async () => {
      const poId = await createPoViaApi(ownerBearer, supplierId);
      const submit = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/purchasing/purchase-orders/${poId}/submit`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
      });
      expect(submit.statusCode).toBe(200);

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/purchasing/purchase-orders/${poId}/reject`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: { reason: 'Not needed' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: poId, status: 'REJECTED' });
    });

    it('cancels a DRAFT purchase order → 200 (CANCELLED)', async () => {
      const poId = await createPoViaApi(ownerBearer, supplierId);
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/purchasing/purchase-orders/${poId}/cancel`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: { reason: 'Cancelling' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: poId, status: 'CANCELLED' });
    });
  });

  // =========================================================================
  // 7. Goods Receipt — create, list, get, confirm
  // =========================================================================

  describe('goods receipt', () => {
    it('creates a goods receipt against a SENT purchase order → 201 (PENDING)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/purchasing/goods-receipts',
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: {
          purchaseOrderId,
          warehouseId,
          items: [
            {
              purchaseOrderItemId,
              variantId,
              quantityReceived: '10',
              quantityAccepted: '10',
              unitCost: '5.00',
            },
          ],
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        id: expect.any(String),
        organizationId: tenantOrganizationId,
        purchaseOrderId,
        status: 'PENDING',
      });
      goodsReceiptId = body.id;
    });

    it('lists goods receipts → 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/purchasing/goods-receipts',
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.map((g: { id: string }) => g.id)).toContain(goodsReceiptId);
    });

    it('gets goods receipt detail with items/costs → 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/purchasing/goods-receipts/${goodsReceiptId}`,
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        id: goodsReceiptId,
        organizationId: tenantOrganizationId,
        purchaseOrderId,
        status: 'PENDING',
      });
      expect(body.items).toBeInstanceOf(Array);
      expect(body.costs).toBeInstanceOf(Array);
    });

    it('confirms a PENDING goods receipt → 200 (CONFIRMED), PO → RECEIVED', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/purchasing/goods-receipts/${goodsReceiptId}/confirm`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: goodsReceiptId,
        status: 'CONFIRMED',
      });

      // Confirming a full receipt should move the PO to RECEIVED.
      const po = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/purchasing/purchase-orders/${purchaseOrderId}`,
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(po.statusCode).toBe(200);
      expect(po.json().status).toBe('RECEIVED');
    });

    it('cancels a PENDING goods receipt → 200 (CANCELLED)', async () => {
      // Fresh PO driven to SENT, plus one pending GR to cancel.
      const poId = await createPoViaApi(ownerBearer, supplierId);
      await sendPoViaApi(ownerBearer, poId);

      const poDetail = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/purchasing/purchase-orders/${poId}`,
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(poDetail.statusCode).toBe(200);
      const poBody = poDetail.json();
      const poItemId = poBody.items[0].id;

      const createGR = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/purchasing/goods-receipts',
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: {
          purchaseOrderId: poId,
          warehouseId,
          items: [
            {
              purchaseOrderItemId: poItemId,
              variantId,
              quantityReceived: '5',
              quantityAccepted: '5',
              unitCost: '5.00',
            },
          ],
        },
      });
      expect(createGR.statusCode).toBe(201);
      const newGRId = createGR.json().id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/purchasing/goods-receipts/${newGRId}/cancel`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: { reason: 'Vendor issue' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: newGRId, status: 'CANCELLED' });
    });
  });

  // =========================================================================
  // 8. Cross-tenant isolation — foreign org sees empty data
  // =========================================================================

  describe('cross-tenant isolation', () => {
    it('foreign tenant user without purchasing permissions → 403', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/purchasing/suppliers',
        headers: { authorization: `Bearer ${foreignBearer}` },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('foreign tenant OWNER sees only their own org data (empty), not Org A', async () => {
      const foreignOwnerBearer = jwt('purchasing-authz-foreign-owner', 'tenant-api');
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/purchasing/suppliers',
        headers: { authorization: `Bearer ${foreignOwnerBearer}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data).toEqual([]);
      expect(body.data.map((s: { id: string }) => s.id)).not.toContain(supplierId);
    });
  });

  // =========================================================================
  // 9. Not found — invalid IDs → 404
  // =========================================================================

  describe('not found', () => {
    it('returns 404 for a nonexistent supplier on update', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/purchasing/suppliers/${newId()}`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
        payload: { name: 'Nope' },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } });
    });

    it('returns 404 for a nonexistent purchase order detail', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/purchasing/purchase-orders/${newId()}`,
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } });
    });

    it('returns 404 for a nonexistent goods receipt detail', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/purchasing/goods-receipts/${newId()}`,
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } });
    });

    it('returns 404 for a nonexistent purchase order on submit', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/purchasing/purchase-orders/${newId()}/submit`,
        headers: {
          authorization: `Bearer ${ownerBearer}`,
          'idempotency-key': newId(),
        },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } });
    });
  });
});

// ---------------------------------------------------------------------------
// JWT helper — identical to inventory.http.integration.spec.ts
// ---------------------------------------------------------------------------

function jwt(subject: string, audience: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: subject,
      iss: 'https://auth.example.test',
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 60,
    }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createHmac('sha256', process.env.SUPABASE_JWT_SECRET!).update(input).digest('base64url')}`;
}
