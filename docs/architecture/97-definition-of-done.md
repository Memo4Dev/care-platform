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

For UI/frontend tasks additionally require — Design Compliance is mandatory:

```text
functional tests pass
Design Compliance Review Gate passes (docs/design/review-checklist.md)
accessibility checks pass where relevant
semantic tokens only; no unjustified hardcoded visual values
responsive behavior verified per docs/design/patterns/responsive.md
light/dark mode compatibility where applicable
```

A UI task is not Done while any item above fails or an open `Design Gap` awaits a human design decision that materially affects the implementation.
