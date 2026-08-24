# Production Readiness Checklist

A release should not go live until the relevant items are verified.

## Architecture

- bounded context ownership is clear
- no direct cross-context table mutation
- Outbox/Inbox configured where needed
- idempotency keys enforced
- concurrency strategy tested

## Database

- production migrations reviewed
- indexes verified
- backup configured
- restore test completed
- connection pool configured
- slow query monitoring enabled

## Security

- secrets outside repository
- TLS enabled
- platform admin MFA enabled
- tenant isolation tests pass
- authorization matrix enforced
- webhook signatures verified
- rate limits configured
- sensitive logs redacted

## Inventory

- reservation concurrency tested
- FIFO verified
- transfer state machine tested
- immutable ledger enforced
- offline conflict flow tested

## Financial

- money precision verified
- payment idempotency tested
- refund limits tested
- wallet ledger reconciles
- credit ledger reconciles
- cash ledger reconciles

## Offline POS

- device registration/revocation works
- local persistence survives restart
- sync is idempotent
- sequence validation works
- reconnect storm tested
- conflict resolution tested

## Operations

- logs/metrics/traces available
- dashboards exist
- actionable alerts configured
- outbox backlog observable
- failed jobs observable/retryable
- runbooks exist

## SaaS Platform

- tenant provisioning idempotent
- subscriptions work
- entitlement limits enforced
- suspended tenant behavior verified
- support access audited and expires

## Recovery

- DB restore tested
- object storage recovery understood
- secret rotation procedure exists
- rollback/forward-fix procedure documented
