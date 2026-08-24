# Integration Event Contracts

Events are versioned public contracts between modules.

## Envelope

```json
{
  "eventId": "...",
  "eventType": "inventory.stock-reserved",
  "eventVersion": 1,
  "occurredAt": "...",
  "organizationId": "...",
  "aggregateType": "Reservation",
  "aggregateId": "...",
  "aggregateVersion": 3,
  "correlationId": "...",
  "causationId": "...",
  "actor": {},
  "payload": {}
}
```

## Naming

Prefer:

```text
context.entity-action
```

Examples:

```text
inventory.stock-reserved
inventory.stock-consumed
purchasing.goods-receipt-confirmed
orders.order-approved
sales.sale-completed
payments.payment-completed
payments.refund-completed
cash.cash-session-reconciled
returns.return-accepted
delivery.delivery-completed
offline.sale-conflict-detected
```

## Compatibility rules

- never silently change meaning of existing fields
- additive optional fields are preferred
- breaking change → new eventVersion
- consumers must ignore unknown optional fields
- IDs remain stable
