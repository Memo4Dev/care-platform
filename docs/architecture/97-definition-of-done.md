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
