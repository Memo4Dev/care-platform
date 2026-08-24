# Tasks

## Ready

None

## In Progress

None

## Done

- Architecture design
- Technology decision
- Agent orchestration design
- Design Compliance Review Gate made mandatory for UI/frontend tasks: `docs/design/review-checklist.md` (process checklist: 10 verification axes, reject list, acceptance triad functional tests + design compliance review + accessibility where relevant, Design Gap policy); machine-readable `design_review_gate` in routing.yaml triggering on frontend/ui/ux/page/component/layout/responsive/styling/dashboard; reviewer manifest owns the gate (+ web-design-guidelines/accessibility skills), qa manifest blocks unmet acceptance criteria; AGENTS.md rule 7 + work loop updated; Design Compliance Gate section in docs/architecture/92-quality-gates.md; frontend DoD block in docs/architecture/97-definition-of-done.md; reviewer findings fixed (checklist ownership exemption, sales-pos in triggers, gate references in implementing manifests); 407-check validation green; independent reviewer PASS WITH NOTES
- Design-system orchestration integration: docs/design/DESIGN.md established as UI source of truth and committed; discoverability added to PROJECT_INDEX.md/project-index.yaml; architecture-index.yaml design_system section (source/tokens/components/patterns); routing.yaml frontend-admin UI rule + conditional design_routing topics (always DESIGN.md, then task-relevant token/component/pattern files only); frontend-admin/storefront manifests read DESIGN.md before any UI work; AGENTS.md mandatory design-system compliance rules; "platform admin" keyword moved to the UI rule with platform-saas as reviewer so admin UI tasks enter the design flow; 327-check validation of all paths/agent IDs/skill IDs green; independent reviewer PASS WITH NOTES
- M0-001 Bootstrap monorepo
- M0-002 Configure quality tooling
- M0-003 Configure Docker local services
- M0-004 Configure CI baseline
- M0-005 Scaffold API modular-monolith shell
- M1-001 Persistence foundation (packages/database Drizzle + packages/testing harness, native-PG/testcontainers dual path, CI postgres service)
- M1-002 Shared contracts package (error catalog, PlatformError, API envelope, pagination, shared zod schemas; ADR-0001 proposed)
- M1-002 Shared contract primitives package `@commerce-platform/contracts`: full error catalog from 62-error-codes.md, `PlatformError` + HTTP status mapping, API envelope + cursor pagination + correlation id primitives, shared zod scalar schemas (money as numeric string), vitest unit suite
- M1-003 Organization bounded context vertical slice (NO HTTP controllers): `organization` schema tables (organizations/branches/warehouses/organization_policies) + `integration.outbox` with committed Drizzle migration; framework-independent domain aggregate (lifecycle transitions guarded against same-state no-ops, branch/warehouse invariants, per-org monotonic policy history); repository with root-version CAS, composite tenant FK backstops and transactional outbox; OrganizationService commands; `OrganizationContracts` provider (GetOrganizationPolicy/GetBranch/GetWarehouse/GetBranchPriority) exported via injection token; Nest module registered in AppModule; Given/When/Then domain unit tests (no DB) + real-PG integration suite (constraints, CAS conflict, outbox exactly-once, policy latest lookup, cross-tenant negative reads)
