# Definition of Done

A feature is not Done when only the endpoint/UI exists.

For a business feature, Done means relevant items are complete:

```text
Domain rule implemented
Domain tests
Authorization
Tenant/branch scoping
Persistence/migration
Idempotency/concurrency where needed
API DTO + stable errors
Audit
Observability
Integration events
Offline behavior considered
Security tests
Documentation updated
```

For cross-context workflows also require:

```text
failure behavior
retry behavior
compensation/resolution behavior
correlation IDs
operational visibility
```

For financial/inventory changes additionally require reconciliation tests.

## HTTP Endpoint Tasks

Any task creating or materially modifying HTTP endpoints additionally requires:

```text
real app.inject boundary tests (not just controller unit tests)
authentication pipeline coverage (valid/missing/invalid JWT)
authorization coverage (capability/role check)
tenant isolation coverage (cross-tenant IDOR masked as 404)
branch/warehouse scope enforcement
validation error envelope coverage
idempotency classification declared (LOCAL_ATOMIC / WORKFLOW_IDEMPOTENT / NOT_REQUIRED)
idempotency behavior tests where applicable
```

## Async/Event Tasks

Any task involving Outbox/Inbox/Worker/Saga additionally requires:

```text
outbox durability (event survives API crash after commit)
relay retry-safe publication by EventId
inbox dedupe per (event_id, consumer)
worker crash checkpoint resumption
convergent replay
observability signals (unpublished count, oldest age, failures)
```

## Environment-Aware Acceptance

Required tests declare infrastructure requirements:

```text
LOCAL: tests runnable with local infrastructure
CI: tests requiring Redis/Docker/external services
```

A test skipped locally because infrastructure is unavailable is NOT
considered green. It is a CI obligation. The task is not accepted
until CI-required tests pass in remote CI.

## For UI/frontend tasks additionally require — Design Compliance is mandatory:

```text
functional tests pass
Design Compliance Review Gate passes (docs/design/review-checklist.md)
accessibility checks pass where relevant
semantic tokens only; no unjustified hardcoded visual values
responsive behavior verified per docs/design/patterns/responsive.md
light/dark mode compatibility where applicable
```

A UI task is not Done while any item above fails or an open `Design Gap` awaits a human design decision that materially affects the implementation.

## Milestone Acceptance

Before declaring a milestone complete:

```text
all milestone tasks accepted
no unresolved blockers
local executable gates green
CI-required gates identified and documented
remote CI green after approved push
state docs reconciled
architecture decisions recorded
migrations validated
skipped required tests accounted for
final milestone regression suite green
```

Never equate "all commits created" with "milestone accepted".
