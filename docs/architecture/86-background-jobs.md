# Background Jobs & Scheduling

## Worker responsibilities

Use workers for:

- outbox publishing
- provider retries
- webhook deferred processing
- reservation expiration
- smart reservation extension checks
- exports
- notifications
- delivery status polling when provider lacks webhooks
- audit archival
- cleanup of disposable technical data

## Scheduler responsibilities

Examples:

```text
expire stale reservations
retry failed provider operations
recalculate entitlement usage snapshots
close/archive old activity periods
detect stale offline devices
```

## Job requirements

Every job should be:

- idempotent
- retry-safe
- observable
- bounded
- tenant-aware

## Retry policy

Use exponential backoff + jitter.

Distinguish:

```text
transient failure
permanent business rejection
poison message
```

Permanent business rejection should not retry forever.

## Dead-letter / failed job handling

Persist:

```text
job id
payload reference
error
attempts
first failure
last failure
correlationId
```

Provide operational admin tools to inspect/retry safely.
