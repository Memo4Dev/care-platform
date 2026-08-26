# Project State

Phase: M1 COMPLETE
Milestone: M1 (SaaS Foundation) — ACCEPTED AND CLOSED
Active task: None
Push/Merge pending: No

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
