# CI/CD Architecture

## Pipeline stages

```text
1. Checkout
2. Install dependencies
3. Lint
4. Type check
5. Unit tests
6. Domain invariant tests
7. Integration tests
8. Security checks
9. Build
10. Migration validation
11. Contract tests
12. Package artifacts
13. Deploy
14. Smoke tests
```

## Branch strategy

Recommended simple model:

```text
main = production-ready
feature/* = isolated work
```

Use short-lived branches and pull requests.

## Required PR checks

- lint
- typecheck
- unit tests
- affected context tests
- migration safety checks
- API contract checks
- security/static analysis
- dependency vulnerability scan

## Deployment

Prefer immutable artifacts.

Example:

```text
commit
→ container image
→ immutable tag/digest
→ deploy staging
→ smoke tests
→ promote same artifact to production
```

Do not rebuild different production artifact from same source after staging approval.

## Database migrations

Migrations run as controlled deployment step.

Use backward-compatible expand/migrate/contract strategy.

## Rollback

Application rollback must consider DB migration compatibility.

Prefer:

- forward-fix for data migrations
- app rollback only if schema remains backward-compatible

## Monorepo CI

Use affected-path detection:

```text
inventory change
→ inventory tests
→ API tests
→ relevant integration tests
```

Global architecture/common package changes trigger broader suite.
