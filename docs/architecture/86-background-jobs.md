# Background Jobs & Scheduling

## Delivery model (M1-009)

One artifact has three independently scalable runtime roles selected with
`RUNTIME_ROLE=api|relay|worker`. The API accepts commands and writes business
state plus an architecture-58 envelope to PostgreSQL `integration.outbox` in
the same local transaction. It never depends on Redis for command durability.

The relay claims unpublished rows using PostgreSQL `FOR UPDATE SKIP LOCKED` and
a short durable lease, validates the envelope, then adds a BullMQ job whose
`jobId` is its stable `eventId`. It marks `published_at` only after BullMQ
accepts the job and only while it owns that row lease. A crash between those
writes is safe: another relay re-adds the same EventId job and then records
publication. Publication failures retain the row for retry and operational
inspection; they are never discarded.

Workers acknowledge a BullMQ job only after a consumer has acquired its own
PostgreSQL Inbox `(event_id, consumer)` lease and durably completed its local
handoff. The opaque Inbox lease ID prevents an expired worker from completing
or releasing a newer lease. Consumers perform checkpointed/idempotent commands;
there is no arbitrary non-atomic queue acknowledgement. Provisioning retries
bind the EventId to `provisioning.retry_requests` and resume the M1-008 durable
process checkpoints, so a delivery retry cannot create duplicate defaults.

Required relay/worker environment is `DATABASE_URL`, `REDIS_HOST`, optional
`REDIS_PORT` (default 6379), `REDIS_DB` (default 0), `REDIS_USERNAME`,
`REDIS_PASSWORD`, and `REDIS_TLS=true` when TLS is required. API-only runtime
requires no Redis configuration. Jobs use exponential retry backoff; failed
BullMQ jobs are retained for operational inspection.

`GET /metrics` is an infrastructure-only Prometheus scrape endpoint. It is
fail-closed unless `METRICS_BEARER_TOKEN` is configured, and callers must send
that value as a bearer credential. Deployments must additionally limit access
to the Prometheus network boundary; unauthenticated requests never execute its
database-backed metric refresh.

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
