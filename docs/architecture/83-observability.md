# Observability Architecture

Three pillars:

```text
Logs
Metrics
Traces
```

## Structured logs

Every log should include where relevant:

```text
timestamp
level
service
environment
correlationId
organizationId
actorId
branchId
deviceId
requestId
resourceType
resourceId
eventType
```

Never log secrets/tokens/raw card data.

## Metrics

### API

- request rate
- latency p50/p95/p99
- error rate
- 4xx/5xx counts
- rate-limit hits

### Database

- active connections
- slow queries
- lock waits
- deadlocks
- replication lag if replicas exist
- table/index growth

### Inventory

- reservation failure rate
- allocation exhaustion
- stock conflict rate
- transfer discrepancies

### Offline

- devices online/offline
- sync lag
- pending operation count
- conflict count
- rejected operation count

### Payments

- success/failure rate
- provider latency
- callback delays
- refund failure rate

### Cash

- reconciliation differences
- unclosed sessions
- duplicate-event prevention count

### Delivery

- provider error rate
- failed attempts
- delivery completion latency

## Distributed tracing

Propagate:

```text
traceId
correlationId
causationId
```

across:

```text
HTTP
background jobs
outbox handlers
provider adapters
sync processing
```

## Alerting

Alert on symptoms users/business care about:

- checkout failure spike
- payment failures
- database saturation
- sync backlog
- inventory reservation errors
- outbox backlog
- webhook failures
- abnormal 5xx rate

Avoid alerting on every low-level warning.
