# Scalability Architecture

## Scale priorities

Likely hot paths:

```text
product search
pricing quote
inventory availability
reservation
POS sale completion
storefront checkout
sync operations
reports
audit queries
```

## API scaling

Application instances are stateless:

```text
Load Balancer
  ├── API 1
  ├── API 2
  └── API N
```

Sessions should not depend on one instance.

## Database scaling

Start with:

- strong indexes
- connection pooling
- query optimization
- read projections
- batch processing

Then consider:

- read replicas for analytics/read-heavy queries
- partitioning for large ledger/audit tables
- archival
- specialized analytics store later

Do not prematurely shard PostgreSQL by tenant.

## Redis

Use for:

- short-lived cache
- rate-limit counters
- distributed locks only when really necessary
- idempotency acceleration
- temporary workflow state if persistence remains authoritative elsewhere

Do not use Redis as source of truth for money or stock.

## Background jobs

Move non-interactive work out of request path:

- emails/SMS
- exports
- report generation
- provider retries
- outbox publishing
- reservation expiration scans
- audit archival
- image processing

## Thundering herd protection

For expensive shared reads:

- request coalescing
- cache
- stale-while-revalidate where safe
- bounded retries

Never cache authoritative stock/payment decisions beyond safe consistency requirements.
