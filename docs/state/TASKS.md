# Tasks

## Ready

None

## In Progress

None

## Done

- Architecture design
- Technology decision
- Agent orchestration design
- M0-001 Bootstrap monorepo
- M0-002 Configure quality tooling
- M0-003 Configure Docker local services
- M0-004 Configure CI baseline
- M0-005 Scaffold API modular-monolith shell
- M1-001 Persistence foundation (packages/database Drizzle + packages/testing harness, native-PG/testcontainers dual path, CI postgres service)
- M1-002 Shared contracts package (error catalog, PlatformError, API envelope, pagination, shared zod schemas; ADR-0001 proposed)
- M1-002 Shared contract primitives package `@commerce-platform/contracts`: full error catalog from 62-error-codes.md, `PlatformError` + HTTP status mapping, API envelope + cursor pagination + correlation id primitives, shared zod scalar schemas (money as numeric string), vitest unit suite
- M1-003 Organization bounded context vertical slice (NO HTTP controllers): `organization` schema tables (organizations/branches/warehouses/organization_policies) + `integration.outbox` with committed Drizzle migration; framework-independent domain aggregate (lifecycle transitions guarded against same-state no-ops, branch/warehouse invariants, per-org monotonic policy history); repository with root-version CAS, composite tenant FK backstops and transactional outbox; OrganizationService commands; `OrganizationContracts` provider (GetOrganizationPolicy/GetBranch/GetWarehouse/GetBranchPriority) exported via injection token; Nest module registered in AppModule; Given/When/Then domain unit tests (no DB) + real-PG integration suite (constraints, CAS conflict, outbox exactly-once, policy latest lookup, cross-tenant negative reads)
