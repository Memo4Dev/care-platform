# Project State

Phase: M1 IN PROGRESS — SaaS Foundation
Milestone: M1 (started)
Active task: M1-007 Platform Management hardened locally per human decision: database-backed Supabase-linked platform principals, roles and capabilities replace caller-supplied roles; operator-bound durable support expiry, provisioning boundary, and subscription tenant-scope FK are covered by native PostgreSQL tests. Full Vitest suite bootstrap failure is fixed locally; no commit made per task instructions.
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
