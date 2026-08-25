# Project State

Phase: M1 IN PROGRESS — SaaS Foundation
Milestone: M1 (started)
Active task: M1-006 Subscription & Billing vertical slice completed locally after blocker remediation: instant-safe renewal, append-only database trigger, expiry fail-closed access checks, and setup-safe native PostgreSQL tests are green; no commit made per task instructions
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
