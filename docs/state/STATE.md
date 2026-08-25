# Project State

Phase: M1 READY FOR PUSH — SaaS Foundation
Milestone: M1 (local exit suite complete; CI Redis gate pending)
Active task: None. M1-010 final native PostgreSQL integration/isolation suite is complete; WRITE/no commit was requested.
Orchestration: design system integrated (docs/design/DESIGN.md is UI source of truth; indexed in project/architecture indexes; conditional design_routing in routing.yaml; frontend-admin/storefront manifests load it first; AGENTS.md design compliance rules). Design Compliance Review Gate now mandatory for UI tasks (review-checklist.md + machine-readable design_review_gate in routing.yaml, enforced by reviewer, qa blocks acceptance). Both independent reviews PASS WITH NOTES; findings fixed. ui-ux-pro-max skill absent from all registries — pending human decision.
Push/Merge pending: No

## Environment constraints

- Local dev machine: macOS 13.7.8 Intel x86_64.
- NO local container runtime; do not install/require Docker/Colima/Lima/QEMU locally.
- Native PostgreSQL: Homebrew postgresql@16 at localhost:5433 (test DB `care_platform_test`, trust auth, localhost-only).
- Native Redis not yet installed; not required for M1 gates.
- Integration tests run against native Postgres via `TEST_DATABASE_URL` locally; Testcontainers/service-container path remains for GitHub Actions CI.
- Docker Compose remains for VPS/staging only; local Docker availability is never a prerequisite for M1 tasks.
- Note: unit AND integration vitest runs now load `vitest.setup.ts`, which provides a placeholder `DATABASE_URL` so eager DI wiring of DatabaseModule can validate without opening sockets.

## M1-007 native integration report

- Passed locally against native PostgreSQL 16 (`TEST_DATABASE_URL=postgres://rize@localhost:5433/care_platform_test`): lifecycle persistence, tenant-scoped architecture-58 outbox, stale CAS rejection, cross-tenant composite-FK injection rejection, explicit support-role authorization, and expiry fail-closed evaluation.
- Passed after Nest bootstrap remediation: format check, lint, typecheck, build, 184 unit tests, and 74 native PostgreSQL integration tests. `PlatformService` explicitly injects its repository token, avoiding erased/undefined reflected constructor metadata during Vitest module transformation.

## M1-008 native integration report

- Passed locally against native PostgreSQL 16: SUB-004 traces a transient entitlement failure, concurrent retries serialize and converge, creates exactly one snapshot-bound initial owner/branch/warehouse, resolves the active subscription entitlement, emits failure/completion outbox events, and keeps the Platform Tenant unavailable until atomic completion.
- Native attacker/immutability coverage rejects forged registration references and mismatched terminal scopes; completed provisioning rows reject direct UPDATE with SQLSTATE 55000. Unit coverage rejects forged, mismatched, serialized and terminal execution capabilities.
- Final local gates green: Prettier format check, ESLint, strict TypeScript typecheck, build, 184 unit tests, and 78 native PostgreSQL integration tests.
- M1-008 blocker remediation: the non-exported execution registry is available only through dedicated Nest issuer/verifier ports; Platform completion consumes the exact opaque scope, verifies registration/tenant/organization/audit execution binding, and reads the locked persisted provisioning row to require all checkpoints with `CREATING_STOREFRONT` status. Plain tuples and legacy registrations are denied; terminal scopes are invalid.

## M1-009 native integration report

- Passed locally against native PostgreSQL 16: format, lint, strict typecheck, build, 185 unit tests and 82 integration tests.
- API bootstraps with correlation IDs and standard error envelopes. Supabase JWT verification validates signature, expiry and separate configured platform/tenant audiences before database principal resolution; roles and organization IDs are never read from request bodies.
- M1-009 review remediation: suspended platform principals fail closed at resolution; ES256 verifies JWT P1363 signatures; Zod failures return the stable validation envelope; list cursor `after` is rejected until implemented; idempotent mutation outcomes persist in `integration.idempotency_outcomes`.
- M1-009 authenticated mutation remediation: explicit Nest injection tokens preserve repository dependencies under Vitest's erased reflected metadata. Native `app.inject` coverage verifies bearer/audience validation, capability denial, successful persistence and exact replay, conflicting key reuse, and missing-key rejection.
- M1-009 durability remediation: native PostgreSQL/app.inject coverage proves retry acceptance atomically persists the request, response outcome and one `ProvisioningRetryRequested` outbox event; same-key replay is stable, changed payload conflicts, and active work is deduplicated. Consumer coverage proves a completed Inbox EventId executes once.
- M1-009 tenant command verification: native PostgreSQL `app.inject` coverage now exercises branch and warehouse authentication, capability denial, tenant list isolation, own-branch scope denial, foreign-branch IDOR rejection (404), required idempotency keys, successful persistence, exact replay and changed-payload conflicts. The route exposed an erased Vitest constructor dependency in `IdentityContractProvider`; explicit injection of `AuthorizationService` restores the real authorization pipeline. Final native gates: format, lint, strict typecheck, build, 185 unit tests, and 91 integration tests with `TEST_DATABASE_URL="postgresql://localhost:5433/postgres"`.
- M1-009 Platform Admin idempotency: every currently exposed tenant lifecycle/register, plan, subscription, and entitlement-override mutation now uses one local PostgreSQL transaction for its idempotency claim, aggregate command, Outbox records, and serialized HTTP outcome. Native Nest `app.inject` coverage verifies Platform tenant lifecycle, plan, subscription, and override replay/conflict behavior; no commit was requested.
- M1-009 delivery architecture: one codebase now has `api`, `relay`, and `worker` runtime roles. PostgreSQL Outbox relay claims use `SKIP LOCKED` plus a durable lease, BullMQ uses EventId job IDs, and only a lease owner marks publication. Workers use per-EventId/consumer Inbox lease IDs and acknowledge only after checkpointed provisioning handoff. Native PG relay/Inbox coverage (93 passed) is included; Redis integration is explicitly gated by `REDIS_INTEGRATION=true` and could not run locally because Redis/Docker are intentionally unavailable. CI provides Redis and runs that coverage.
- M1-009 final delivery blockers: `GET /metrics` now fails closed before its database refresh unless `METRICS_BEARER_TOKEN` exactly matches the Prometheus bearer credential; deployment documentation requires a Prometheus-only network boundary. CI creates the authenticated `ci` Redis ACL principal, disables `default`, validates its authenticated `PING`, and runs the Redis-gated relay→worker retry/dedupe integration test with that principal. Local final gates passed: format, lint, strict typecheck, build, 193 unit tests, and 96 native PostgreSQL integration tests; the two Redis integration tests remain intentionally skipped locally because native Redis/Docker are unavailable. No commit was requested.
- M1-009 final tenant-auth blocker: `TenantBearerGuard` resolves an organization principal only after an active user is linked to a Platform Tenant with `ACTIVE` status and `COMPLETED` provisioning. Missing or incomplete links return `TENANT_PROVISIONING_INCOMPLETE`; suspended or closed tenants return `TENANT_SUSPENDED`. Native Fastify `app.inject` coverage verifies unlinked, pending, suspended, and closed denial paths. Final local gates passed: format, lint, strict typecheck, build, 193 unit tests, and 97 native PostgreSQL integration tests; Redis-gated tests remain intentionally skipped locally. No commit was requested.

## M1-010 final integration/isolation report

- Native PostgreSQL final suite passes trusted-registration → Platform registration API → provisioning → activation → Owner bearer login → default branch/warehouse readiness, authenticated plan-limit rejection, concurrent different-key `branches.max=1` serialization, foreign-branch IDOR masking, composite tenant-FK injection denial, and suspended-tenant access denial.
- Provisioning now grants the initial Owner explicit access to the deterministic default branch through the narrow Identity provisioning contract after Organization creates that branch. This completes the M1 owner-login readiness path without cross-context persistence writes.
- Final local gates passed: Prettier format check, ESLint, strict TypeScript typecheck, build, 193 unit tests, and 103 native PostgreSQL integration tests. Redis-gated integration tests remain skipped locally by design; CI must run them with `REDIS_INTEGRATION=true` and authenticated Redis before M1 is accepted after push.
- Independent scenario/gap mapping: `docs/state/M1-010-TEST-GAP-REPORT.md`. TEN-001 is deferred to M5 because Sales does not exist in M1; it has not been falsely substituted with another resource.
