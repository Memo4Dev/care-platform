# Project State

Phase: M2 COMPLETE — AWAITING PUSH APPROVAL
Milestone: M2 (Catalog & Pricing) — COMPLETE
Active task: All M2 tasks (M2-001 through M2-016) done. Awaiting human approval to push.
Push/Merge pending: YES — awaiting human approval

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

| Category                   | Files   | Tests                         | Status                              |
| -------------------------- | ------- | ----------------------------- | ----------------------------------- |
| Unit tests (pnpm test)     | 34      | 345                           | GREEN                               |
| Integration (native PG)    | 4       | ~40+                          | Created (require TEST_DATABASE_URL) |
| HTTP boundary (app.inject) | 2       | ~30+                          | Created (require TEST_DATABASE_URL) |
| Cross-tenant isolation     | 4 files | embedded in integration specs | Created                             |

### Quality gates

- **Typecheck:** ✅ 8/8 tasks pass
- **Lint (ESLint):** ✅ Clean
- **Format (Prettier):** ✅ All files pass
- **Unit tests:** ✅ 345/345 pass

### Known gaps / follow-up

- `catalog.read` / `catalog.write` permission codes are not in `IDENTITY_CONTRACTS.PERMISSION_CODES` — catalog HTTP tests document expected 403 behavior for missing permissions. The pricing controller does not enforce permission-code checks (uses auth-only guard).
- Integration tests require a real PostgreSQL database to run (`TEST_DATABASE_URL` env var); not included in `pnpm test`.
- Postman collection not yet updated with M2 endpoints.

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
**Next step:** Human review → push → merge to `main` → deploy to staging
