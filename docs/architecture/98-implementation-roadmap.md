# Implementation Roadmap

Goal: evolve the current system into the target architecture without a risky full rewrite.

## Principle

Use incremental replacement/refactoring.

```text
Current System
    ↓
Stabilize boundaries
    ↓
Extract modules
    ↓
Introduce new persistence/contracts
    ↓
Migrate workflows
    ↓
Retire legacy paths
```

Avoid:

```text
stop everything
rewrite whole system
switch all users at once
```

## Recommended phases

### Phase 0 — Baseline / Safety
- inventory current codebase
- map existing tables/endpoints
- add tests around critical existing flows
- add observability and error tracking
- freeze undocumented direct DB mutations

### Phase 1 — Platform Foundation
- Organization
- Identity & Access
- Branch/Warehouse
- Platform Admin
- Subscription
- Plans & Entitlements
- Tenant Provisioning

### Phase 2 — Catalog & Pricing
- Product
- Variant
- Units
- Barcode
- Categories
- Price Books
- Promotions/Coupons baseline

### Phase 3 — Inventory Core
- StockPosition
- Inventory Ledger
- FIFO Layers
- Reservations
- Allocations
- Transfers
- Adjustments

### Phase 4 — Purchasing
- Suppliers
- Purchase Orders
- Goods Receipts
- Actual Cost allocation
- FIFO integration

### Phase 5 — Sales / Cart / Payments / Cash
- POS Cart
- Sales Drafts
- Sale
- Invoice
- Payment
- Wallet
- Credit
- Cash Sessions / Treasury

### Phase 6 — Orders / Fulfillment / Returns / Delivery
- Orders
- Fulfillment planning
- Multi-warehouse
- Returns
- Delivery adapters

### Phase 7 — Storefront
- Store config
- Product publication
- Online customer
- Checkout
- Online order approval

### Phase 8 — Offline POS
- local DB
- bootstrap
- sync protocol
- idempotency
- allocations
- conflict resolution

### Phase 9 — Hardening
- audit
- security
- load tests
- DR
- runbooks
- production readiness

Each phase must pass its acceptance gate before the next one becomes the primary focus.
