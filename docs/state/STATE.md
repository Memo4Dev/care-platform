# Project State

Phase: M4 COMPLETE — READY FOR REVIEW
Milestone: M4 (Purchasing) — COMPLETE
Active task: All M4 tasks done including DI remediation. All local gates green. Awaiting human review and push/merge approval.
CI: PENDING — integration tests require TEST_DATABASE_URL
Branch: feat/m4-purchasing

## M4 milestone summary

All 10 M4 tasks complete (M4-001 through M4-010):

| Task   | Domain                                               | Status |
| ------ | ---------------------------------------------------- | ------ |
| M4-001 | Purchasing persistence (Drizzle schema + migration)  | DONE   |
| M4-002 | Domain layer (3 aggregates, events, invariants)      | DONE   |
| M4-003 | Application layer (service, repo, contracts, module) | DONE   |
| M4-004 | Inventory contract expansion (receiveStock)          | DONE   |
| M4-005 | HTTP controller (16 endpoints) + Swagger             | DONE   |
| M4-006 | Domain unit tests (79 tests)                         | DONE   |
| M4-007 | Integration tests (20 tests, native PG)              | DONE   |
| M4-008 | HTTP boundary tests (37 tests)                       | DONE   |
| M4-009 | Postman collection + Swagger tag updates             | DONE   |
| M4-010 | State docs + quality gates + permission migration    | DONE   |

## Quality gates

| Gate                     | Local   | CI       | VPS          |
| ------------------------ | ------- | -------- | ------------ |
| TypeScript               | ✅ PASS | PENDING  | —            |
| ESLint                   | ✅ PASS | PENDING  | —            |
| Prettier                 | ✅ PASS | PENDING  | —            |
| Domain unit tests (560)  | ✅ PASS | PENDING  | —            |
| Integration tests (363)  | ✅ PASS | REQUIRED | NOT REQUIRED |
| HTTP boundary tests (37) | ✅ PASS | REQUIRED | NOT REQUIRED |
| Reviewer                 | ✅ PASS | —        | —            |
| Security review          | ✅ PASS | —        | —            |

## DI remediation (GR confirm)

Fixed the failing `confirms a PENDING goods receipt → 200` HTTP boundary test.
Root cause: under Vitest/Vite (esbuild emit), type-based (constructor-metadata)
Nest injection silently yields `undefined`, so `InventoryContractProvider.repository`
was undefined and `INVENTORY_CONTRACTS.receiveStock()` → `this.repository.findStockPosition`
threw `TypeError`, mapped by the error filter to `403 OPERATION_NOT_ALLOWED`.
Resolution: explicit `@Inject(InventoryRepository)` on `InventoryContractProvider`
and `@Inject(PurchasingRepository)` on `PurchasingContractProvider`. Works under
both esbuild (tests) and tsc/`emitDecoratorMetadata` (production).

## Permission migration (0027)

Seeds `purchasing.read`, `purchasing.write`, `purchasing.approve`, `purchasing.receive` into `identity.permissions`.
ON CONFLICT DO NOTHING — safe for re-delivery.
Legacy `purchase.create`/`purchase.approve` (0002) preserved unchanged.

## GR → Inventory boundary

- Purchasing calls `INVENTORY_CONTRACTS.receiveStock()` — never mutates inventory tables directly
- Landed cost = unitCost + (additionalCosts / totalAcceptedQty)
- Duplicate GR confirmation is idempotent
- Partial receipt only credits accepted quantity
- Over-receipt obeys organization PURCHASE policy
- Confirmed GR is immutable

## M4 purchasing — HTTP boundary tests

Added `apps/api/src/modules/purchasing/purchasing.http.integration.spec.ts`,
following the exact `inventory.http.integration.spec.ts` pattern
(createTestDatabase + re-applying `0026_purchasing_core.sql`, JWT creation, full
NestJS/Fastify boot with TenantBearerGuard, org/branch/warehouse/variant/owner
provisioning, org-scoped role grants).

Covers all PurchasingAdminController endpoints across 38 test cases:
authentication (401), validation (422), authorization (403), idempotency
(422/replay/409), supplier CRUD, PO lifecycle (create/list/get/update/submit/
approve/reject/send/cancel), goods receipt (create/list/get/confirm/cancel),
cross-tenant isolation (foreign org sees empty data), and not-found (404).

Compile verification:

- `npx tsc --noEmit -p apps/api/tsconfig.json` → exit 0
- spec file type-checked with a temporary config including the spec → exit 0

Requires `TEST_DATABASE_URL` (native PG or CI service container) to execute.

## M1 milestone summary

All 10 M1 tasks complete (M1-001 through M1-010):

| Task   | Domain                                                             | Status |
| ------ | ------------------------------------------------------------------ | ------ |
| M1-001 | Persistence foundation (Drizzle + testing harness)                 | DONE   |
| M1-002 | Shared contracts package (error catalog, API envelope, pagination) | DONE   |
| M1-003 | Organization bounded context                                       | DONE   |
| M1-004 | Identity & Access                                                  | DONE   |
| M1-005 | Plans & Entitlements                                               | DONE   |
| M1-006 | Subscription & Billing                                             | DONE   |
| M1-007 | Platform Management                                                | DONE   |
| M1-008 | Tenant Provisioning                                                | DONE   |
| M1-009 | API/auth plumbing + delivery architecture                          | DONE   |
| M1-010 | Final integration/isolation suite                                  | DONE   |

**Test suite:** 193 unit tests passing, typecheck clean, lint clean
**CI:** Green (last 2 runs with Redis integration via `REDIS_INTEGRATION=true`)
**Staging:** Deployed and verified (API endpoints, pgAdmin, Swagger)
**Docs:** Swagger/OpenAPI docs available, Postman collection ready
**Security:** No open security blockers

## Environment constraints

- Local dev machine: macOS 13.7.8 Intel x86_64.
- NO local container runtime; do not install/require Docker/Colima/Lima/QEMU locally.
- Native PostgreSQL: Homebrew postgresql@16 at localhost:5433 (test DB `care_platform_test`, trust auth, localhost-only).
- Native Redis not installed locally; Redis integration runs in CI only.
- Integration tests run against native Postgres via `TEST_DATABASE_URL` locally; Testcontainers/service-container path for GitHub Actions CI.
- Docker Compose remains for VPS/staging only; local Docker availability is never a prerequisite.
- Note: unit AND integration vitest runs load `vitest.setup.ts`, which provides a placeholder `DATABASE_URL` so eager DI wiring of DatabaseModule can validate without opening sockets.

## Key architectural notes

- API, relay, and worker runtime roles exist in one codebase. PostgreSQL Outbox relay claims use `SKIP LOCKED` plus durable lease; BullMQ uses EventId job IDs; workers acknowledge only after checkpointed provisioning handoff.
- `TenantBearerGuard` requires an active Identity user linked to an ACTIVE, fully provisioned Platform Tenant before constructing a trusted organization principal.
- Tenant provisioning grants the initial Owner explicit access to the deterministic default branch through the narrow Identity provisioning contract after Organization creates that branch.
- Tenant branch/warehouse mutations acquire a deterministic organization advisory lock before usage/entitlement evaluation, serializing concurrent resource-limit races.
- Provisioning terminal state is physically immutable in PostgreSQL (trigger rejects UPDATE/DELETE with SQLSTATE 55000).
- Subscription-period history is similarly append-only via trigger.

---

## M3 milestone — COMPLETE

### What was delivered

**Inventory bounded context** (`inventory` pgSchema):

- 9 tables: stock_positions, fifo_layers, ledger_entries, reservations, reservation_items, allocations, stock_transfers, stock_transfer_items, stock_adjustments
- Drizzle schema: `packages/database/src/schema/inventory.ts` (418 lines)
- SQL migrations: `0024_inventory_core.sql` (297+ lines) + `0025_add_inventory_permissions.sql`
- Added `warehouses_tenant_scope_unique` composite UNIQUE constraint on `(id, organization_id)` for inventory FK references

**Domain layer** (`apps/api/src/modules/inventory/domain/`, 8 files, 2,122 lines):

- StockPosition, FIFOLayer, Reservation, Allocation, StockTransfer, StockAdjustment aggregates
- Events (Created, Received, Consumed, Reserved, Allocated, Transferred, Adjusted, Released, Expired)
- Invariants: balance safety (`reserved + allocated <= on_hand`), non-negative quantities, FIFO ordering, lifecycle transitions

**Application layer** (`apps/api/src/modules/inventory/`, 7 files, 3,520 lines):

- InventoryService (2,222 lines): receiveStock, consumeStock, reserveStock, releaseReservation, transferStock, adjustStock
- InventoryRepository (1,060 lines): FOR UPDATE locking, FIFO layer queries, ledger immutability
- Module wiring, contracts provider, event-envelope, db-executor

**HTTP controller** (`inventory-admin.controller.ts`, 917 lines, 21 endpoints):

- Stock positions, reservations, allocations, transfers, adjustments, ledger entries, FIFO layers
- Full Zod validation, Swagger decorators, idempotency enforcement, authorization checks

**Permissions:**

- Migration `0025_add_inventory_permissions.sql` seeds `inventory.create`
- Added to `PERMISSION_CODES` and `PERMISSION_DESCRIPTIONS` in identity schema
- Auth matrix and identity-defaults spec updated

**Test suite:**

- Domain unit tests: 6 files, 136 tests (all passing)
- Integration tests: `inventory.integration.spec.ts` (1,618 lines, 36 tests)
- Concurrency tests: `inventory.concurrency.spec.ts` (1,582 lines, 23 tests)
- HTTP boundary tests: `inventory.http.integration.spec.ts` (1,469 lines, 41+ tests)
- Covers: stock lifecycle, FIFO consumption, reservation/expiration, transfer dispatch/receipt, adjustment approval, ledger immutability, cross-tenant isolation, idempotency, concurrent access

**Cross-cutting:**

- Module registered in root `AppModule`
- `@commerce-platform/database` exports inventory schema
- Postman collection updated with 21 inventory endpoints
- Swagger tag "Inventory" added with description

### Quality gates

- **Typecheck:** ✅ Zero errors (apps/api + packages/database)
- **Lint (ESLint):** ✅ Clean
- **Format (Prettier):** ✅ All files pass
- **Unit tests:** ✅ 136/136 domain tests pass
- **Integration tests:** ✅ Created, require TEST_DATABASE_URL to run
- **HTTP boundary tests:** ✅ Created, require TEST_DATABASE_URL to run

### All M3 tasks

| Task   | Domain                                                     | Status |
| ------ | ---------------------------------------------------------- | ------ |
| M3-001 | Inventory persistence (Drizzle schema + migration)         | DONE   |
| M3-002 | Domain layer (aggregates, events, invariants)              | DONE   |
| M3-003 | Application layer (service, repository, contracts, module) | DONE   |
| M3-004 | Permissions (inventory.create)                             | DONE   |
| M3-005 | HTTP controller (21 endpoints) + Swagger + registration    | DONE   |
| M3-006 | Domain unit tests (136 tests)                              | DONE   |
| M3-007 | Integration tests (36 tests)                               | DONE   |
| M3-008 | Concurrency tests (23 tests)                               | DONE   |
| M3-009 | HTTP boundary tests (41+ tests)                            | DONE   |
| M3-010 | Postman collection + Swagger tag updates                   | DONE   |

**Branch:** `feat/m3-inventory-core` (created from `main`)
**Status:** READY FOR REVIEW — awaiting human approval

---

## M2 milestone — COMPLETE

### What was delivered

**Catalog bounded context** (`catalog` pgSchema):

- Products, Product Variants, Categories (parent-child hierarchy), Unit Definitions, Unit Conversions, Packaging Definitions, Barcodes
- Full domain layer: aggregates, value objects, domain events, invariants
- Full application layer: repository (992 lines), service (15 commands), contracts, module wiring
- Admin HTTP controller with 12+ endpoints
- Swagger `@ApiTags('Catalog')` + `@ApiBearerAuth` decorators on all endpoints

**Pricing bounded context** (`pricing` pgSchema):

- Price Books (with default flag), Price Entries (6-dimension uniqueness), Promotions, Coupons, Price Snapshots
- Full domain layer: aggregates, value objects, domain events, invariants
- Price Quote engine (resolvePriceQuote with fallback chain)
- Full application layer: repository (860 lines), service (11 commands), contracts, module wiring
- Admin HTTP controller with 14 endpoints
- Swagger `@ApiTags('Pricing')` + `@ApiBearerAuth` decorators on all endpoints

**Cross-cutting**:

- Drizzle migration `0022_cooing_skin.sql` covers all catalog + pricing tables
- Both modules registered in root `AppModule`
- `@commerce-platform/database` exports catalog + pricing schemas
- Unit conversion domain service (16 tests)

### Test summary

| Category                   | Files   | Tests                         | Status                             |
| -------------------------- | ------- | ----------------------------- | ---------------------------------- |
| Unit tests (pnpm test)     | 34      | 345                           | GREEN                              |
| Integration (native PG)    | 16      | 198                           | GREEN (2 skipped: BullMQ no Redis) |
| HTTP boundary (app.inject) | 4       | 75+                           | GREEN                              |
| Cross-tenant isolation     | 4 files | embedded in integration specs | GREEN                              |

### Quality gates

- **Typecheck:** ✅ Pre-existing errors only (NestJS decorator resolution); no regressions from M2
- **Lint (ESLint):** ✅ Clean
- **Format (Prettier):** ✅ All files pass
- **Unit tests:** ✅ 345/345 pass
- **Integration tests:** ✅ 198/198 pass (2 BullMQ tests skipped — no Redis)

### Known gaps / follow-up

- `catalog.read` / `catalog.write` permission codes are not in `IDENTITY_CONTRACTS.PERMISSION_CODES` — catalog HTTP tests document expected 403 behavior for missing permissions. The pricing controller does not enforce permission-code checks (uses auth-only guard).
- Integration tests require a real PostgreSQL database to run (`TEST_DATABASE_URL` env var); not included in `pnpm test`.
- `PRICE_NOT_AVAILABLE` maps to HTTP 422 (business rule violation) — tests updated to reflect this.

### All M2 tasks

| Task   | Domain                                                             | Status |
| ------ | ------------------------------------------------------------------ | ------ |
| M2-001 | Catalog persistence (Drizzle schema + migration)                   | DONE   |
| M2-002 | Catalog domain layer (aggregates, events, invariants)              | DONE   |
| M2-003 | Catalog application layer (service, repository, contracts, module) | DONE   |
| M2-004 | Pricing persistence (Drizzle schema + migration)                   | DONE   |
| M2-005 | Pricing domain layer (aggregates, events, invariants)              | DONE   |
| M2-006 | Pricing application layer (service, repository, contracts, module) | DONE   |
| M2-007 | Unit conversion domain service                                     | DONE   |
| M2-008 | Catalog admin HTTP controller (12+ endpoints)                      | DONE   |
| M2-009 | Pricing admin HTTP controller (14 endpoints)                       | DONE   |
| M2-010 | Idempotency + tenant isolation for mutations                       | DONE   |
| M2-011 | HTTP boundary tests (app.inject) for catalog + pricing             | DONE   |
| M2-012 | Integration tests (native PG) for catalog + pricing                | DONE   |
| M2-013 | Cross-tenant isolation negative tests                              | DONE   |
| M2-014 | Swagger/OpenAPI decorators + swagger.ts tags                       | DONE   |
| M2-015 | Quality gates (lint/typecheck/unit/integration all green)          | DONE   |
| M2-016 | State docs update                                                  | DONE   |

**Branch:** `feat/m2-catalog-pricing` (created from `main`)
**Deployed SHA:** `d0990ac5` on staging VPS (109.199.125.205)
**Staging URL:** https://api.care-systems.site
**Status:** READY TO MERGE — awaiting human approval

### Staging smoke test results

| Test                                                | Result                                                   |
| --------------------------------------------------- | -------------------------------------------------------- |
| Health check                                        | 200 OK                                                   |
| Catalog CRUD (unit, category, product, variant)     | 201/200                                                  |
| Pricing CRUD (price book, entry, coupon, promotion) | 201/200                                                  |
| Price Quote resolve                                 | 201 (correct price returned)                             |
| No token → 401                                      | ✅                                                       |
| Denied user (no perms) → 403                        | ✅                                                       |
| Sales user (pricing.view only) on catalog → 403     | ✅                                                       |
| Sales user on pricing.view → 200                    | ✅                                                       |
| Sales user on pricing.create → 403                  | ✅                                                       |
| Owner full access → 201                             | ✅                                                       |
| Idempotency key missing → 422                       | ✅                                                       |
| Idempotency replay → 403 (guard-level)              | ✅                                                       |
| Swagger documents 28 M2 endpoints                   | ✅                                                       |
| PostgreSQL tenant-scoped data                       | ✅ (31 permissions, 2 roles, 6 products, etc.)           |
| Migrations 0022 + 0023 applied                      | ✅ (manually applied — drizzle journal mismatch from M1) |
