# Environment Strategy

Recommended environments:

```text
local
test
development
staging
production
```

## Local

Developers run:

- API
- Worker
- PostgreSQL
- Redis
- local object-storage emulator if needed

Prefer containers for repeatability.

## Test

Used for automated integration/contract tests.

Characteristics:

- disposable DB
- deterministic seeds
- fake providers
- no production credentials

## Development

Shared team environment.

Use synthetic data only.

## Staging

Production-like:

- same topology classes
- same deployment mechanism
- masked/synthetic data
- provider sandbox accounts
- realistic migrations

## Production

Strict access controls and immutable deployment audit.

## Configuration

Use environment variables / secret manager.

Do not use:

```text
.env committed to repo
hard-coded secrets
production credentials in CI logs
```

## Feature Flags

Use for controlled rollout of risky features:

```text
offline-pos-v2
new-pricing-engine
new-delivery-provider
```

Feature flags are not a replacement for Plans/Entitlements.
