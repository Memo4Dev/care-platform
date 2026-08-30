# Project State

Phase: M5 IN PROGRESS
Milestone: M5 (Sales & POS Core)
Active task: Auth architecture correction verification (ADR-0011) — Supabase JWT `aud` is the token's API audience only, not the Platform/Tenant authorization boundary; server-side principal resolvers + RBAC enforce Platform/Tenant separation after Supabase identity verification. Core change verified on disk (main.ts guard call removed, auth-config deleted, matchesAudience array membership); new `auth-boundary.security.spec.ts` (6 tests) proves the boundary at guard/resolver level; `supabase-jwt.service.spec.ts` gained tampered/unsigned/malformed negatives; ADR-0011 accepted. All local gates green; change uncommitted, awaiting orchestrator review and commit.
CI: M4 main CI run 38 for merge `05d9292` passed; M5 changes are unpushed and have no remote CI run yet. Historical staging credential rotation remains required before push.
Branch: feat/m5-sales-pos-core

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

| Gate                     | Local                  | CI                   | VPS |
| ------------------------ | ---------------------- | -------------------- | --- |
| TypeScript               | ✅ full PASS           | pending              | —   |
| ESLint                   | ✅ full PASS           | pending              | —   |
| Prettier                 | ✅ full PASS           | pending              | —   |
| Unit tests               | ✅ 603 PASS            | pending              | —   |
| Integration tests        | ✅ 446 PASS, 2 skipped | Redis required in CI | —   |
| POS Cart PostgreSQL/HTTP | ✅ 27 + 31 PASS        | pending              | —   |
| Auth unit/security       | ✅ 15 PASS (auth dir)  | pending              | —   |
| Build                    | ✅ full PASS           | pending              | —   |
| Reviewer                 | ✅ PASS                | pending              | —   |
| Security review          | ✅ PASS                | pending              | —   |

## Auth boundary correction (ADR-0011) current verification

- Approved correction: authentication audience separation is no longer the
  Platform-vs-Tenant authorization boundary. `aud` identifies the token's
  intended API audience only; Platform/Tenant separation is enforced
  server-side after Supabase identity verification by principal resolvers +
  RBAC (references ADR-0004/ADR-0005, ADR-0011 accepted).
- Core change verified intact on disk: `main.ts` no longer calls
  `assertSeparatedBearerAudiences()`; `auth-config.ts`/`auth-config.spec.ts`
  are deleted; `SupabaseJwtService.matchesAudience()` accepts a token whose
  `aud` includes the expected audience (single string or array membership).
  Zero references to `auth-config` or `assertSeparatedBearerAudiences` remain
  outside the ADR (repo-wide grep).
- New `auth-boundary.security.spec.ts` (6 tests, real SupabaseJwtService +
  real guards + real DatabasePlatformPrincipalResolver with an in-memory
  subject-aware fake DATABASE): valid-JWT verification to subject; valid JWT
  without `platform.principals` row denied (PERMISSION_DENIED); ACTIVE row
  allowed as PLATFORM_USER and non-ACTIVE row denied; organization user
  without platform row denied on platform endpoints and platform user without
  `identity.users` membership denied on tenant endpoints; caller-injected
  role/capability/permission/organizationId claims ignored (verified subject +
  DB only); tenant user with ACTIVE status and COMPLETED/ACTIVE tenant
  resolves as ORGANIZATION_USER with server-derived organizationId.
- `supabase-jwt.service.spec.ts` adds the missing negative coverage: unsigned
  (2-part), malformed, empty, extra-segment, tampered-payload and
  corrupted-signature tokens are all rejected with INVALID_CREDENTIALS.
- Pre-existing coverage confirmed (not duplicated): tenant isolation item 6
  (purchasing/catalog/pricing/api integration specs), wrong issuer/audience/
  expired negatives (supabase-jwt spec), tenant lifecycle denials
  (TENANT_SUSPENDED/TENANT_PROVISIONING_INCOMPLETE in api/cart HTTP specs).
- Gates for this change: `apps/api/src/common/auth` unit run 15/15 green;
  full `pnpm typecheck` green; `pnpm lint` green (ESLint + Prettier);
  targeted tsc over auth dir + new spec green. Change is uncommitted on
  `feat/m5-sales-pos-core` (opencode.json was already dirty and untouched);
  no push/merge/deploy.

## M5-005 current verification

- ADR-0010 accepted: one explicit same-branch warehouse per Cart hold, one
  atomic logical Inventory reservation, no warehouse auto-split, empty-hold
  rejection, held Cart non-editable until resume, and `CART` policy default TTL
  15 minutes with 1–1440-minute bounds.
- Additive persistence migration `0030_cart_hold_reservation.sql` adds Cart hold
  workflow state, expands Inventory reservation precision/grouping support, and
  extends Organization policy type for `CART`.
- Cart exposes `POST /api/v1/pos/carts/{cartId}/hold` and bodyless
  `POST /api/v1/pos/carts/{cartId}/resume` through the transitional
  `PosOperatorGuard`, `sales.create`, Organization/branch access, `If-Match`, and
  `Idempotency-Key`.
- Cart calls Inventory only through `INVENTORY_CONTRACTS`; Inventory owns
  all-or-nothing reservation creation, exact eight-decimal quantities,
  deterministic locking, idempotent release/lazy expiration, and due-reservation
  worker wiring.
- Targeted local verification so far: API typecheck passed; focused unit tests 22
  passed; Cart PostgreSQL/HTTP tests 49 passed; Inventory Cart reservation,
  migration, concurrency, persistence, and HTTP regressions 127 passed. Full
  format/lint/unit/integration/build gates and independent reviews passed for
  M5-005 acceptance.
- M5-005 final local verification: full format, lint, typecheck, build, and diff
  checks pass; 603 unit tests and 446 native PostgreSQL integration tests pass
  (2 Redis/BullMQ tests remain CI-required). Independent correctness review PASS
  and security review PASS. Crash/retry recoverability for the Cart hold
  workflow is covered: a retried in-progress PENDING hold converges to ACTIVE
  (never lands as a poisoned PENDING Cart), and a stale PENDING hold with no
  Inventory reservation is terminalized by resume to unblock edits. The CART
  hold TTL policy is validated with 1–1440 integer bounds in the Organization
  domain. M5-005 is committed as `feat(m5): cart hold/resume reservation` on
  `feat/m5-sales-pos-core`; not pushed or deployed.

## M5-006 current verification

- Cart imports `PricingModule` and depends on `PRICING_CONTRACTS` +
  `InventoryContracts`; cross-context reads only, no Pricing/Inventory table
  access from Cart.
- New POS surface: `POST /api/v1/pos/carts/{cartId}/quote` (optional `priceType`,
  default `CASH`), `POST /api/v1/pos/carts/{cartId}/check-availability`
  (`{ warehouseId }`), and `GET /api/v1/pos/products/barcode/{barcode}?branchId=`
  via new `PosProductController`. All enforce `PosOperatorGuard`, `sales.create`,
  Organization, and branch access.
- `CartService.quote()` resolves live prices per line and computes 8-decimal
  `lineTotal`/`total` via integer math; `checkAvailability()` validates the
  warehouse belongs to the Cart's branch, converts each line's requested
  quantity to the variant's base unit, and returns exact 8-decimal
  available/shortage (including `unitId`) with no reservation.
- Barcode scan `GET /api/v1/pos/products/barcode/{barcode}` resolves a variant
  through Catalog and sets `sellable` only when both variant and product are
  ACTIVE (non-ACTIVE variants return `sellable: false`).
- Fixed a Pricing `getPriceQuote` effective-date pre-filter bug: the SQL
  `effectiveFrom`/`effectiveTo` range is now `effectiveFrom <= date < effectiveTo`
  (previously an inverted `effectiveFrom >= date` condition made normally-dated
  entries unresolvable), matching the `resolvePriceQuote` domain contract.
- Decimal helpers are integer-based at 8-decimal scale; the sign-parsing path
  was hardened so negative inputs clamp to zero instead of corrupting to a
  positive value (money-integrity safety for validated non-negative inputs).
- New tests: 3 Cart service integration tests (quote, availability + shortage,
  foreign-warehouse rejection) and 5 HTTP tests (quote, availability, foreign
  warehouse/branch 403/404, barcode resolve + not-found, DRAFT barcode
  `sellable:false`). Cart service now 27, Cart HTTP now 32.
- Local gates: typecheck, lint, prettier, build PASS; 537 unit; cart+pricing
  PostgreSQL/HTTP integration 108+ PASS. `git diff --check` clean. Independent
  correctness (PASS with findings) and security (PASS) reviews complete;
  correctness findings resolved. Pending commit.

## M5-003 current verification

- Customers persistence and HTTP boundary use real PostgreSQL with the full
  NestJS/Fastify `app.inject` pipeline.
- Focused domain/application unit tests: 7 passed.
- Focused PostgreSQL persistence and HTTP tests: 13 passed (3 persistence,
  10 HTTP), including concurrent duplicate-code handling, tenant IDOR masking,
  malformed-ID validation, and idempotency replay/conflict behavior.
- Full native PostgreSQL regression passed: 376 passed, 2 Redis-only tests
  skipped. Redis/BullMQ execution remains a CI-required gate.
- The current M5 implementation is not deployed to staging.

## M5-004 current verification

- Cart persistence now includes `cart.carts` and `cart.cart_items` through the
  reviewed additive migration `0029_cart_core.sql`.
- The framework-independent Cart aggregate supports only editable POS Draft
  carts, decimal-string quantities, repeated-line merging, line updates/removal,
  optimistic versions, tenant-scoped outbox envelopes, and durable idempotent
  HTTP outcomes.
- The only Cart HTTP contract is now `/api/v1/pos/carts`, with canonical
  `/items` resources and `POST /:cartId/save`; obsolete tenant-admin and
  `/lines` routes return 404 and are absent from Swagger/Postman.
- `PosOperatorGuard` uses the verified tenant JWT only as an explicit M5 online
  transition. It resolves a trusted active `ORGANIZATION_USER` server-side and
  still enforces `sales.create`, Organization scope, and branch access. It does
  not claim POS Device, Employee Card/Barcode + PIN, Cash Session, or offline
  identity support.
- Save is a version-bound `LOCAL_ATOMIC` durable acknowledgement. It locks the
  tenant Cart root, stores replayable HTTP outcome state, and changes no Cart
  field/item or `updatedAt`; it emits no event and calls no Pricing, Inventory,
  or Sales contract.
- Final local verification passes: 597 unit tests and 420 native PostgreSQL
  integration tests, with 2 Redis/BullMQ tests skipped locally and still
  required in CI. Cart contributes 19 persistence and 25 full `app.inject`
  HTTP tests (44 total). Full lint, format, typecheck, build, Drizzle schema
  validation, and `git diff --check` pass.
- Reviewer remediation serializes normalized no-op item updates by locking the
  tenant-scoped Cart root before version validation and durable replay outcome
  persistence; a real-PostgreSQL lock-contention test proves the behavior.
- Security remediation rejects missing/equal platform and tenant JWT audiences
  at API startup, rejects signed audience arrays spanning both trust domains,
  limits unexpected-error logging and persistence error details, and adds tenant
  lifecycle, suspended operator, foreign nested-reference, and
  actor/organization idempotency-scope coverage. [SUPERSEDED by ADR-0011: the
  startup rejection of equal platform/tenant audiences and the rejection of
  `aud` arrays spanning both domains were removed; the JWT `aud` is the token's
  API audience only, and Platform/Tenant separation is enforced server-side by
  the principal resolvers + RBAC after Supabase identity verification.]
- The test harness emitted an existing `pg@9` deprecation warning about a
  concurrent `client.query()` call; it did not affect test results.
- The earlier POS/admin route, `/save`, concurrency, and security findings are
  implemented and locally verified. Independent correctness and security
  re-reviews pass. M5-004 is not deployed or pushed.

## Staging deployment — 2026-08-27

- **Deployed branch/SHA:** `feat/m4-purchasing` / `57bff5c`
- **Runtime database:** `care_platform_staging`; all 28 Drizzle migrations applied.
- **M4 verification:** six `purchasing` tables exist and all four `purchasing.*`
  permissions are seeded.
- **Services:** API, worker, relay, PostgreSQL, and Redis are running. Public
  `/health` returns 200; unauthenticated Purchasing read returns 401.
- **VPS test isolation:** tests used `care_platform_integration` as the admin
  database and Redis database 1. The live relay/worker use Redis database 0;
  isolation prevents them consuming BullMQ test jobs. Test-created
  `care_platform_test_*` databases were cleaned up (zero remain).
- **Deployment reconciliation:** `compose.staging.yaml` now explicitly owns the
  `care-platform` project and existing default network while declaring the
  PostgreSQL/Redis volumes external. The first reconciliation took verified
  logical backups of both databases before recreating only the stateful
  containers against those preserved volumes. A second deployment completed
  without stateful-container recreation, proving the compose workflow is
  repeatable.
- **Deployment command:** `scripts/deploy-staging.sh [branch]` now defaults to
  the current branch, requires `VPS_SSH_PASSWORD` at runtime, leaves secrets on
  the VPS, creates the staging database idempotently, migrates it, and replaces
  only stateless API/worker/relay containers.

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
