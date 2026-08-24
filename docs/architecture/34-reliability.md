# Reliability, Transactions & Concurrency

## Outbox
Business change + Outbox message are committed in the same DB transaction.

## Inbox
Consumers store MessageId/EventId before/with side-effect commit.

## Optimistic concurrency
Mutable aggregates carry `version`.

## Idempotency required for
- payment callbacks
- refunds
- delivery provider callbacks
- offline operations
- invoice issuance
- event consumers
- inventory consumption

## Cross-context rule
Do not create one giant DB transaction for:
Sale + Inventory + Payment + Cash + Audit.

Use local transactions + process manager/saga + Outbox.
