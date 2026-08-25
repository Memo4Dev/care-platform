---
name: quality-gates
description: Run all relevant format/lint/typecheck/unit/integration/contract/security tests with environment awareness.
---

# quality-gates

## Instructions

Run all relevant format/lint/typecheck/unit/integration/contract/security tests.
Required gates must be green. Never weaken tests to obtain green.

## Environment-Aware Testing

Tests declare infrastructure requirements. Distinguish:

### LOCAL
Tests that run with available local infrastructure (filesystem, native PostgreSQL).

### CI
Tests that require infrastructure only available in CI (Redis, Docker, external services).
These tests are skipped locally but MUST execute in CI.

### Reporting

Report clearly:
```
Code gates: GREEN
PostgreSQL integration: GREEN (103 passed)
Redis integration: NOT EXECUTED LOCALLY / REQUIRED IN CI
```

Never report "ALL TESTS GREEN" when required tests were skipped.
A skipped-required test is not acceptance — it is a CI obligation.

## CI-Only Test Requirements

If tests cannot execute locally because infrastructure is unavailable:
- record them explicitly in state docs
- keep them required
- run them in CI
- verify they actually executed in CI logs
- remote CI must be green before milestone acceptance

Do not convert required tests into optional/skipped tests
just to obtain a local green state.

## Host Mutation Safety

Agents must not install host-level system services/tools merely to satisfy tests.

Do NOT automatically execute:
- `brew install redis`
- `brew services start redis`
- host PostgreSQL installation
- system-wide daemon changes

without explicit user approval.

Preferred hierarchy:
1. existing project dependency (pnpm add)
2. existing project infrastructure (Docker Compose)
3. Testcontainers
4. GitHub Actions service containers
5. staging infrastructure
6. host mutation only with explicit approval

Package dependencies (`pnpm add bullmq`) are different from
host-level installations and may be performed when task-scoped.

## Fix Loop Rule

A blocker found by reviewer/security/QA must:
- reopen the active task if necessary
- enter a fix loop
- remain unresolved until behavior is proven
- receive regression coverage where applicable

Do not mark a blocker resolved merely because:
- a test file was created
- implementation code exists
- a reviewer comment was acknowledged

Resolution requires passing behavioral evidence.

## Always

- Read `AGENTS.md`.
- Use the architecture routing index.
- Do not silently change architecture.
- Never push/merge without human approval.
