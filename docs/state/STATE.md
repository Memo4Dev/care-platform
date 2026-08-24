# Project State

Phase: M1 IN PROGRESS — SaaS Foundation
Milestone: M1 (started)
Active task: M1-002 implemented locally (packages/contracts: error catalog + PlatformError + envelope/pagination/correlation primitives + shared zod schemas), all gates green, no commits made per task instructions; M1-001 previously awaited independent review + commit
Push/Merge pending: No

## Environment constraints

- Local dev machine: macOS 13.7.8 Intel x86_64.
- NO local container runtime; do not install/require Docker/Colima/Lima/QEMU locally.
- Native PostgreSQL: Homebrew postgresql@16 at localhost:5433 (test DB `care_platform_test`, trust auth, localhost-only).
- Native Redis not yet installed; not required for M1 gates.
- Integration tests run against native Postgres via `TEST_DATABASE_URL` locally; Testcontainers/service-container path remains for GitHub Actions CI.
- Note: the stopped Colima default VM was deleted during pre-constraint troubleshooting (before human instruction); recreate manually if desired.
