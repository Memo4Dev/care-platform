import { createHmac } from 'node:crypto';
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
 * HTTP boundary tests for the Pricing Admin controller authorization matrix.
 *
 * Follows the exact pattern of api.integration.spec.ts and
 * catalog.http.integration.spec.ts:
 * - createTestDatabase() for real PG
 * - Full NestJS app bootstrap with TenantBearerGuard
 * - JWT creation for tenant authentication
 * - Organization + branch + owner provisioning via IdentityProvisioningService
 * - Organization-scoped role grants to control per-user permission sets
 * - app.inject() for HTTP calls
 *
 * Permission codes enforced by PricingAdminController:
 * - `pricing.view`  — all GET (list/read) endpoints + POST quote
 * - `pricing.create` — POST (create) endpoints + coupon redeem
 * - `pricing.edit`   — PATCH (update) endpoints + set default price book
 * - `pricing.delete` — future deactivate endpoints
 *
 * Users under test:
 * - Owner:   OWNER role  → ALL permission codes (including all pricing.*)
 * - Sales:   SALES role  → only ['sales.create', 'catalog.view', 'pricing.view']
 * - Denied:  no role     → zero permissions
 * - Foreign: Org B user  → OWNER role (ALL pricing.*, sees empty lists)
 */
describe('Pricing HTTP boundary — Authorization matrix', () => {
  let testdb: TestDatabase;
  let app: NestFastifyApplication;

  // JWT tokens for distinct user personas
  let ownerBearer: string;
  let salesBearer: string;
  let deniedBearer: string;
  let foreignBearer: string;

  // Shared state for cross-test assertions
  let tenantOrganizationId: string;

  let originalDatabaseUrl: string | undefined;

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    testdb = await createTestDatabase();
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testdb.uri;
    process.env.SUPABASE_JWT_SECRET = 'pricing-authz-test-secret';
    process.env.SUPABASE_JWT_ISSUER = 'https://auth.example.test';
    process.env.SUPABASE_PLATFORM_AUDIENCE = 'platform-api';
    process.env.SUPABASE_TENANT_AUDIENCE = 'tenant-api';

    // --- Services ---
    const organizationsService = new OrganizationService(testdb.db, new OrganizationRepository());
    const identityProvisioning = new IdentityProvisioningService(
      testdb.db,
      new UserRepository(),
      new RoleRepository(),
    );

    // === Org A (main org) ================================================

    const tenant = await organizationsService.createOrganization({
      name: 'Pricing Authz Org A',
    });
    tenantOrganizationId = tenant.organization.id;
    const tenantBranchId = newId();
    await organizationsService.createBranch({
      organizationId: tenantOrganizationId,
      branchId: tenantBranchId,
      code: 'PR-AUTHZ',
      name: 'Pricing Authz Main Branch',
    });

    // --- Owner: OWNER role → ALL permission codes (incl. all pricing.*) ---
    const owner = await identityProvisioning.provisionInitialOwner({
      organizationId: tenantOrganizationId,
      email: 'pricing-authz-owner@example.test',
      name: 'Pricing Authz Owner',
      supabaseUserId: 'pricing-authz-owner',
      correlationId: newId(),
      causationId: newId(),
    });
    await testdb.db.insert(branchAccess).values({
      organizationId: tenantOrganizationId,
      branchId: tenantBranchId,
      userId: owner.user.id,
    });

    // --- Sales user: SALES role → pricing.view only ----------------------
    const salesUserId = newId();
    await testdb.db.insert(users).values({
      id: salesUserId,
      organizationId: tenantOrganizationId,
      supabaseUserId: 'pricing-authz-sales',
      email: 'pricing-authz-sales@example.test',
      name: 'Pricing Authz Sales',
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

    // --- Denied user: no role → no permissions ---------------------------
    await testdb.db.insert(users).values({
      id: newId(),
      organizationId: tenantOrganizationId,
      supabaseUserId: 'pricing-authz-denied',
      email: 'pricing-authz-denied@example.test',
      name: 'Pricing Authz Denied',
    });

    // === Org B (foreign org) =============================================

    const foreign = await organizationsService.createOrganization({
      name: 'Pricing Authz Org B',
    });
    const foreignOrganizationId = foreign.organization.id;
    const foreignBranchId = newId();
    await organizationsService.createBranch({
      organizationId: foreignOrganizationId,
      branchId: foreignBranchId,
      code: 'PR-FOREIGN',
      name: 'Pricing Authz Foreign Branch',
    });
    const foreignOwner = await identityProvisioning.provisionInitialOwner({
      organizationId: foreignOrganizationId,
      email: 'pricing-authz-foreign-owner@example.test',
      name: 'Pricing Authz Foreign Owner',
      supabaseUserId: 'pricing-authz-foreign-owner',
      correlationId: newId(),
      causationId: newId(),
    });
    await testdb.db.insert(branchAccess).values({
      organizationId: foreignOrganizationId,
      branchId: foreignBranchId,
      userId: foreignOwner.user.id,
    });

    // === Subscriptions + Platform Tenants ==================================

    const now = new Date();

    // Org A
    const tenantPlanId = newId();
    await testdb.db.insert(plans).values({
      id: tenantPlanId,
      code: 'PRICING_AUTHZ_PLAN',
      name: 'Pricing Authz Plan',
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
      code: 'PRICING_AUTHZ_FOREIGN_PLAN',
      name: 'Pricing Authz Foreign Plan',
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

    ownerBearer = jwt('pricing-authz-owner', 'tenant-api');
    salesBearer = jwt('pricing-authz-sales', 'tenant-api');
    deniedBearer = jwt('pricing-authz-denied', 'tenant-api');
    foreignBearer = jwt('pricing-authz-foreign-owner', 'tenant-api');

    // === Bootstrap NestJS app =============================================

    app = await createApp();
    await app.init();

    // === Seed shared resources for downstream tests =======================

    // Create a price book via owner (needed for update/set-default/cross-tenant tests)
    const priceBookRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/pricing/price-books',
      headers: { authorization: `Bearer ${ownerBearer}` },
      payload: { name: 'Authz Seed Book', isDefault: true },
    });
    expect(priceBookRes.statusCode).toBe(201);
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
        url: '/api/v1/admin/pricing/price-books',
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    });

    it('rejects a request with wrong JWT audience → 401', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${jwt('pricing-authz-owner', 'platform-api')}` },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
    });
  });

  // =========================================================================
  // 2–4. Authorized operations — Owner with ALL pricing permissions
  // =========================================================================

  describe('allowed operations', () => {
    it('allows owner with pricing.create to create a price book → 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${ownerBearer}` },
        payload: { name: 'Owner Price Book', isDefault: false },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data).toMatchObject({
        resourceType: 'PriceBook',
        eventsPersisted: 1,
      });
    });

    it('allows owner with pricing.view to list price books → 200 with data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Authz Seed Book' })]),
      );
    });

    it('allows owner with pricing.edit to update a price book → 200', async () => {
      // Create a price book to update
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${ownerBearer}` },
        payload: { name: 'To Be Updated' },
      });
      expect(createRes.statusCode).toBe(201);
      const bookId = createRes.json().data.resourceId;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/pricing/price-books/${bookId}`,
        headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
        payload: { name: 'Updated Price Book' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        data: { id: bookId, name: 'Updated Price Book' },
      });
    });

    it('allows owner with pricing.edit to set default price book → 201', async () => {
      // Create a second price book
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${ownerBearer}` },
        payload: { name: 'New Default Book' },
      });
      const bookId = createRes.json().data.resourceId;

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/pricing/price-books/${bookId}/default`,
        headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
      });
      expect(response.statusCode).toBe(201);
    });

    it('allows owner with pricing.create to create a price entry → 201', async () => {
      // Seed catalog prerequisites (unit + product + variant) for FK constraints
      const unitId = newId();
      const productId = newId();
      const variantId = newId();
      await testdb.db.execute(/* sql */ `
        INSERT INTO catalog.unit_definitions (id, organization_id, name, symbol, is_base_unit, version)
        VALUES ('${unitId}', '${tenantOrganizationId}', 'Each', 'ea', true, 1)
      `);
      await testdb.db.execute(/* sql */ `
        INSERT INTO catalog.products (id, organization_id, name, status, version)
        VALUES ('${productId}', '${tenantOrganizationId}', 'HTTP test product', 'ACTIVE', 1)
      `);
      await testdb.db.execute(/* sql */ `
        INSERT INTO catalog.product_variants
          (id, organization_id, product_id, name, base_unit_id, status, version)
        VALUES ('${variantId}', '${tenantOrganizationId}', '${productId}', 'Default', '${unitId}', 'ACTIVE', 1)
      `);

      // Create a price book via the API to get a valid ID
      const bookRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${ownerBearer}` },
        payload: { name: 'Entry Test Book' },
      });
      const priceBookId = bookRes.json().data.resourceId;

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/price-entries',
        headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
        payload: {
          priceBookId,
          variantId,
          unitId,
          priceType: 'CASH',
          channel: 'POS',
          amount: '1500.75',
          effectiveFrom: '2025-01-01',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data).toMatchObject({
        resourceType: 'PriceEntry',
        eventsPersisted: 1,
      });
    });

    it('allows owner with pricing.create to create a promotion → 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/promotions',
        headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
        payload: {
          name: 'Owner Promotion',
          type: 'PERCENTAGE',
          target: 'PRODUCT',
          value: '10',
          startDate: '2025-01-01',
          endDate: '2025-12-31',
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data).toMatchObject({
        resourceType: 'Promotion',
        eventsPersisted: 1,
      });
    });

    it('allows owner with pricing.create to create a coupon → 201', async () => {
      // Create a promotion to attach the coupon to
      const promoRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/promotions',
        headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
        payload: {
          name: 'Coupon Parent',
          type: 'FIXED_AMOUNT',
          target: 'ORDER',
          value: '5',
          startDate: '2025-01-01',
          endDate: '2025-12-31',
        },
      });
      const promotionId = promoRes.json().data.resourceId;

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/coupons',
        headers: { authorization: `Bearer ${ownerBearer}`, 'idempotency-key': newId() },
        payload: {
          code: 'OWNER-COUPON',
          type: 'FIXED_AMOUNT',
          value: '10',
          promotionId,
          maxUses: 100,
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data).toMatchObject({
        resourceType: 'Coupon',
        eventsPersisted: 1,
      });
    });

    it('allows owner with pricing.view to list coupons → 200', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pricing/coupons',
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeInstanceOf(Array);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('allows owner with pricing.view to resolve price quote → 200', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/quote',
        headers: { authorization: `Bearer ${ownerBearer}` },
        payload: {
          variantId: newId(),
          unitId: newId(),
          priceType: 'CASH',
          channel: 'POS',
        },
      });
      // Quote succeeds (may be 200 with price, or 422 PRICE_NOT_AVAILABLE if no matching entry)
      expect([200, 422]).toContain(response.statusCode);
    });
  });

  // =========================================================================
  // 5–7. Denied operations — users lacking specific permission codes
  // =========================================================================

  describe('denied operations', () => {
    it('denies sales user (pricing.view only) from creating a price book → 403', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${salesBearer}` },
        payload: { name: 'Should Not Create' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('denies sales user (pricing.view only) from updating a price book → 403', async () => {
      // Get a valid price book id from the seeded list
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      const bookId = listRes.json().data[0].id;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/pricing/price-books/${bookId}`,
        headers: { authorization: `Bearer ${salesBearer}`, 'idempotency-key': newId() },
        payload: { name: 'Should Not Update' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('denies user with no role from listing price books → 403', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${deniedBearer}` },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('denies sales user (pricing.view only) from creating a price entry → 403', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/price-entries',
        headers: { authorization: `Bearer ${salesBearer}`, 'idempotency-key': newId() },
        payload: {
          priceBookId: newId(),
          variantId: newId(),
          unitId: newId(),
          priceType: 'CASH',
          amount: '999',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('denies sales user (pricing.view only) from creating a promotion → 403', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/promotions',
        headers: { authorization: `Bearer ${salesBearer}`, 'idempotency-key': newId() },
        payload: {
          name: 'Should Not Create Promo',
          type: 'PERCENTAGE',
          target: 'PRODUCT',
          value: '10',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('denies sales user (pricing.view only) from creating a coupon → 403', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/coupons',
        headers: { authorization: `Bearer ${salesBearer}`, 'idempotency-key': newId() },
        payload: {
          code: 'SHOULD-NOT-EXIST',
          type: 'FIXED_AMOUNT',
          value: '5',
          promotionId: newId(),
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });

    it('allows sales user (pricing.view only) to resolve price quote (but no price found → 422)', async () => {
      // POST /quote requires only pricing.view; sales user has it, so auth passes.
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/quote',
        headers: { authorization: `Bearer ${salesBearer}` },
        payload: {
          variantId: newId(),
          unitId: newId(),
          priceType: 'CASH',
          channel: 'POS',
        },
      });
      // Auth passes (pricing.view), but no matching price → 422 PRICE_NOT_AVAILABLE
      expect([200, 422]).toContain(response.statusCode);
    });

    it('denies user with no role from resolving price quote → 403', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/quote',
        headers: { authorization: `Bearer ${deniedBearer}` },
        payload: {
          variantId: newId(),
          unitId: newId(),
          priceType: 'CASH',
          channel: 'POS',
        },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    });
  });

  // =========================================================================
  // 8. Cross-tenant isolation
  // =========================================================================

  describe('cross-tenant isolation', () => {
    it('foreign tenant owner with ALL pricing.* permissions sees empty lists → 200 with []', async () => {
      // Foreign owner (Org B) has OWNER role → ALL pricing permissions in Org B.
      // Authorization succeeds, but query is scoped to Org B → empty lists.
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${foreignBearer}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toEqual([]);
    });

    it('foreign tenant owner sees empty price entries → 200 with []', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pricing/price-entries',
        headers: { authorization: `Bearer ${foreignBearer}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    });

    it('foreign tenant owner sees empty promotions → 200 with []', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pricing/promotions',
        headers: { authorization: `Bearer ${foreignBearer}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    });

    it('foreign tenant owner sees empty coupons → 200 with []', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pricing/coupons',
        headers: { authorization: `Bearer ${foreignBearer}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
    });
  });

  // =========================================================================
  // 9. Idempotency key enforcement
  // =========================================================================

  describe('idempotency key enforcement', () => {
    it('rejects price entry creation without Idempotency-Key → 422', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/price-entries',
        headers: { authorization: `Bearer ${ownerBearer}` },
        payload: {
          priceBookId: newId(),
          variantId: newId(),
          unitId: newId(),
          priceType: 'CASH',
          amount: '500',
        },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: 'VALIDATION_FAILED' },
      });
    });

    it('rejects promotion creation without Idempotency-Key → 422', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/promotions',
        headers: { authorization: `Bearer ${ownerBearer}` },
        payload: {
          name: 'No Key Promo',
          type: 'PERCENTAGE',
          target: 'PRODUCT',
          value: '10',
        },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: 'VALIDATION_FAILED' },
      });
    });

    it('rejects coupon creation without Idempotency-Key → 422', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/pricing/coupons',
        headers: { authorization: `Bearer ${ownerBearer}` },
        payload: {
          code: 'NO-KEY-COUPON',
          type: 'FIXED_AMOUNT',
          value: '5',
          promotionId: newId(),
        },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: 'VALIDATION_FAILED' },
      });
    });

    it('rejects price book update without Idempotency-Key → 422', async () => {
      // Get a valid price book id
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      const bookId = listRes.json().data[0].id;

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/pricing/price-books/${bookId}`,
        headers: { authorization: `Bearer ${ownerBearer}` },
        payload: { name: 'No Key Update' },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: 'VALIDATION_FAILED' },
      });
    });

    it('rejects set default price book without Idempotency-Key → 422', async () => {
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/pricing/price-books',
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      const bookId = listRes.json().data[0].id;

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/pricing/price-books/${bookId}/default`,
        headers: { authorization: `Bearer ${ownerBearer}` },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        error: { code: 'VALIDATION_FAILED' },
      });
    });
  });
});

// ---------------------------------------------------------------------------
// JWT helper — identical to api.integration.spec.ts
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
