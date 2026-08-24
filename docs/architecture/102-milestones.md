# Milestones

## M0 — Architecture Baseline
Done:
- bounded contexts
- persistence
- APIs
- security
- infra
- testing
- execution plan

## M1 — SaaS Foundation
Deliver:
- Organization
- Branch/Warehouse
- Identity/RBAC
- Platform Admin
- Subscription
- Entitlements
- Provisioning

Exit criteria:
- create tenant end-to-end
- owner login
- branch access enforced
- plan limits enforced

## M2 — Product Foundation
Deliver:
- Catalog
- Variant
- Units
- Barcode
- Pricing

Exit:
- branch/channel price quote correct
- unit conversion tests pass

## M3 — Inventory Foundation
Deliver:
- ledger
- FIFO
- stock positions
- reservation
- allocation
- transfer
- adjustment

Exit:
- concurrent reservation test
- FIFO reconciliation
- transfer lifecycle

## M4 — Purchasing
Deliver:
- supplier
- PO
- receipt
- actual cost

Exit:
- GoodsReceipt creates correct FIFO layers

## M5 — POS Commerce
Deliver:
- Cart
- Sales
- Invoice
- Payments
- Wallet/Credit
- Cash Management

Exit:
- cash sale E2E
- credit sale E2E
- reconciliation correct

## M6 — Operations
Deliver:
- Orders
- Fulfillment
- Returns
- Delivery

Exit:
- online-style order lifecycle works via internal API

## M7 — Storefront
Deliver:
- public store
- online customer
- checkout
- approval flow

Exit:
- online checkout E2E

## M8 — Offline POS
Deliver:
- local DB
- sync
- allocations
- conflicts

Exit:
- offline/reconnect test suite passes

## M9 — Production Hardening
Deliver:
- audit
- observability
- DR
- load/security tests
- runbooks

Exit:
- Production Readiness checklist passes
