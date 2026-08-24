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
