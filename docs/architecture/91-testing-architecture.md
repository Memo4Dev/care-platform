# Testing Architecture

## Testing Pyramid

```text
            E2E
        Contract Tests
     Integration Tests
   Domain / Unit Tests
```

Most business rules should be proven below the E2E layer.

## Domain Tests

Each Aggregate must test:

- valid transitions
- invalid transitions
- invariants
- organization policies
- permission-dependent overrides
- emitted Domain Events
- money/quantity precision

Critical domains:

```text
Inventory
Orders
Sales
Payments & Accounts
Cash Management
Returns
Purchasing
Offline Sync
Subscriptions/Entitlements
```

## Integration Tests

Use real PostgreSQL-compatible behavior for:

- transactions
- row locking
- unique constraints
- composite tenant constraints
- FIFO concurrency
- reservations
- Outbox/Inbox
- idempotency

Do not rely only on mocks for these.

## API Tests

Verify:

- request validation
- authentication
- authorization
- tenant isolation
- branch scope
- DTO serialization
- stable error codes
- idempotency
- optimistic concurrency

## Contract Tests

Contracts to protect:

```text
Admin API
Platform API
POS API
Storefront API
Sync API
Webhooks
Integration Events
Provider Adapters
```

## E2E Scenarios

Critical E2E flows:

1. Organization provisioning → owner login → branch/warehouse ready.
2. Purchase → Goods Receipt → FIFO stock.
3. POS cash sale → inventory → payment → cash ledger → invoice.
4. POS credit sale → customer debt.
5. Online checkout → reservation → approval → fulfillment → delivery.
6. Return → stock disposition → debt/wallet/refund.
7. Branch transfer → InTransit → receive.
8. Offline sale → reconnect → accepted sync.
9. Offline stock conflict → manager resolution.
10. Subscription suspension → entitlement/business access behavior.

## Test Data

Factories/builders should create valid domain state.

Avoid large shared fixtures that make tests dependent on execution order.
