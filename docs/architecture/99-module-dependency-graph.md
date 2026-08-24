# Module Dependency Graph

Implementation order follows dependency direction, not UI priority.

```text
Platform Management
Subscription / Entitlements
        ↓
Organization
        ↓
Identity & Access
        ↓
Catalog
        ↓
Pricing
        ↓
Customers
        ↓
Inventory
        ↓
Purchasing
        ↓
Cart
        ↓
Orders / Sales
        ↓
Payments & Accounts
        ↓
Cash Management
        ↓
Fulfillment
        ↓
Returns / Delivery
        ↓
Storefront
        ↓
Offline Sync
```

Cross-cutting:

```text
Audit & Activity
Reliability / Outbox / Inbox
Security
Observability
```

## Hard dependency rules

Inventory depends on:
- Organization
- Catalog

Pricing depends on:
- Catalog
- Organization

Sales depends on:
- Catalog
- Pricing
- Customers
- Inventory contracts
- Payments contracts

Offline Sync depends on:
- POS Device Identity
- Sales
- Inventory
- Orders
- reliability/idempotency

Storefront depends on:
- Catalog
- Pricing
- Cart
- Orders
- Inventory read models
- Delivery quote
- Payments

Do not implement a downstream module by duplicating missing upstream logic.
