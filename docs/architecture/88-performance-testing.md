# Performance & Load Testing

## Workload profiles to test

### POS peak

```text
many concurrent sales
barcode lookup
pricing quote
cash payment
inventory consumption
```

### Online campaign

```text
high storefront reads
cart creation
checkout
reservation contention
```

### Offline reconnect storm

```text
many POS devices reconnect
large sync batches
conflict detection
projection updates
```

### Reporting

```text
large date ranges
multi-branch aggregations
exports
```

## Critical tests

- concurrent reservation oversell test
- FIFO layer contention
- payment webhook duplicate storm
- outbox backlog recovery
- sync replay/idempotency
- large tenant isolation query performance
- cash reconciliation under concurrent events

## Performance budgets

Define per user-facing workflow later.

Track p50/p95/p99 rather than average only.

## Query budgets

Every frequently executed query should have:

- expected index
- expected cardinality
- explain plan review under realistic data
