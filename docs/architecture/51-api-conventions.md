# API Conventions

## Error envelope

```json
{
  "error": {
    "code": "INVENTORY_INSUFFICIENT",
    "message": "Requested quantity is not available.",
    "details": {},
    "correlationId": "..."
  }
}
```

Categories:

```text
VALIDATION_*
AUTHENTICATION_*
AUTHORIZATION_*
CONFLICT_*
INVENTORY_*
PAYMENT_*
ORDER_*
OFFLINE_*
PROVIDER_*
```

## Pagination

Prefer cursor-based:

```text
?limit=50&after=<cursor>
```

Response:

```json
{
  "data": [],
  "page": {
    "nextCursor": null,
    "hasMore": false
  }
}
```

## Idempotency

Use `Idempotency-Key` on:
- create payment
- refund
- finalize sale
- create external shipment
- offline operation batch
- goods receipt confirmation

### Durable HTTP outcomes versus event delivery

HTTP idempotency and integration-event idempotency are separate controls. A
retriable HTTP mutation stores its request hash and complete response under the
authenticated mutation scope and `Idempotency-Key`; matching retries replay the
same response and a different request under that key returns HTTP 409.

When accepting a command starts asynchronous work, the owning context commits
the accepted request/workflow reference, HTTP outcome and Outbox event in one
local transaction. It must not execute the workflow before this transaction is
durable. Consumers record the integration `eventId` in Inbox state and process
each completed event once; a failed delivery remains resumable only where the
target workflow has durable checkpoints. HTTP keys are never used as Inbox
event IDs.

## Concurrency

For mutable aggregates expose version:

```json
{ "id": "...", "version": 8 }
```

Update may require:

```text
If-Match: 8
```

Conflict → HTTP 409.
