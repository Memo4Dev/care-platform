# Persistence Architecture

Primary DB: PostgreSQL.

## Logical schemas

```text
organization
identity
catalog
pricing
customers
inventory
purchasing
cart
orders
sales
fulfillment
payments
cash
returns
delivery
storefront
offline
audit
integration
```

## Global rules

- UUIDv7 for technical IDs.
- Human-readable numbers are separate business identifiers.
- Every tenant-owned table contains organization_id.
- Prefer UNIQUE (organization_id, business_key).
- Use optimistic concurrency version columns on mutable aggregates.
- Do not generic-soft-delete immutable financial/operational history.
- Use numeric, never float, for money and quantities.
- Use timestamptz.
- Local transaction boundary normally stays inside one Context.
- Use Outbox/Inbox for cross-context reliability.
