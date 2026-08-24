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
