# Integration Event Contracts

Events are versioned public contracts between modules.

## Envelope

```json
{
  "eventId": "...",
  "eventType": "inventory.stock-reserved",
  "eventVersion": 1,
  "occurredAt": "...",
  "eventScope": "TENANT",
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

## Scope

Every envelope declares exactly one scope:

- `TENANT` events require a non-null `organizationId` and consumers must scope
  handling to that organization.
- `GLOBAL` events require `organizationId: null`; consumers must not infer a
  tenant from a global aggregate. Plan lifecycle and plan entitlement events
  are global.

Producers and consumers validate this invariant before publishing or handling
an event. `eventScope` is additive in envelope version 1 so consumers that
ignore unknown fields remain compatible; consumers that need tenant context
must validate it rather than assuming `organizationId` is always present.

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
