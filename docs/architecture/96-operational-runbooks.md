# Operational Runbooks

Runbooks describe what operators do when production is unhealthy.

## Database Saturation

1. inspect connection pool and active sessions
2. inspect slow/blocked queries
3. identify deployment/query regression
4. reduce non-critical background workload
5. scale/read-route only when safe
6. document incident

## Outbox Backlog

1. verify worker health
2. measure oldest unpublished event
3. inspect poison/failing event
4. restore consumer dependency
5. replay idempotently
6. confirm backlog returns to normal

## Payment Provider Outage

1. mark provider operational status
2. stop uncontrolled retry storms
3. preserve pending Payments
4. expose safe user-facing pending/failure state
5. retry according to policy
6. reconcile provider/internal references after recovery

## Delivery Provider Outage

Do not cancel Orders automatically.

Use:

```text
retry
switch provider
internal delivery
manual resolution
```

according to organization policy.

## POS Sync Backlog

1. inspect device/server sync health
2. throttle batch sizes if necessary
3. prioritize idempotent operation ingestion
4. monitor conflicts
5. avoid deleting local operations before acknowledgment

## Suspected Tenant Data Leak

Treat as high-severity security incident:

1. restrict affected access
2. preserve logs/audit
3. identify query/API path
4. validate tenant isolation
5. rotate credentials if relevant
6. follow incident/privacy obligations

## Compromised POS Device

1. revoke device
2. revoke/rotate device credential
3. preserve submitted operation history
4. inspect unusual offline/sales operations
5. register replacement device separately
