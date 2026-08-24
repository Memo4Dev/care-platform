# Project State

Phase: M1 IN PROGRESS — SaaS Foundation
Milestone: M1 (started)
Active task: M1-003 implemented locally (Organization bounded context vertical slice: organization/integration schemas + first Drizzle migration, framework-independent domain aggregate with branches/warehouses/policies, transactional-outbox repository with optimistic concurrency, application service + module contract provider, Nest wiring without controllers; domain unit tests + real-PG integration tests), all gates green, no commits made per task instructions
Push/Merge pending: No

## Environment constraints

- Local dev machine: macOS 13.7.8 Intel x86_64.
- NO local container runtime; do not install/require Docker/Colima/Lima/QEMU locally.
- Native PostgreSQL: Homebrew postgresql@16 at localhost:5433 (test DB `care_platform_test`, trust auth, localhost-only).
- Native Redis not yet installed; not required for M1 gates.
- Integration tests run against native Postgres via `TEST_DATABASE_URL` locally; Testcontainers/service-container path remains for GitHub Actions CI.
- Docker Compose remains for VPS/staging only; local Docker availability is never a prerequisite for M1 tasks.
- Note: unit AND integration vitest runs now load `vitest.setup.ts`, which provides a placeholder `DATABASE_URL` so eager DI wiring of DatabaseModule can validate without opening sockets.
