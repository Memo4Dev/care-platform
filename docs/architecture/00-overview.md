# Architecture Overview

This repository documents a production-oriented, multi-tenant commerce platform with:

- Web
- Mobile
- POS
- Admin Dashboard
- Backend/API
- Per-organization Storefront

Architecture style:

- Domain-Driven Design
- Modular Monolith first
- Event-ready boundaries
- PostgreSQL primary database
- Offline-capable POS with local persistence and synchronization

Core platform capabilities:

- Multi-organization isolation
- Multi-branch
- Multi-warehouse
- Product variants and configurable units
- Branch/channel pricing
- FIFO inventory costing
- Inventory reservations and POS allocations
- Purchasing and supplier management
- POS and internal sales
- Online Storefront
- Orders and fulfillment
- Payments, wallet, credit/debt
- Cash Management / Treasury
- Returns and refunds
- Internal/external delivery
- Offline conflict resolution
- RBAC + branch scope
- Immutable ledgers and audit

## Primary architectural rules

1. Organization is the tenant boundary.
2. Bounded Contexts own their own business state.
3. Cross-context writes happen through commands/events/interfaces, not direct table mutation.
4. Inventory, wallet, credit, cash and audit histories are append-oriented/immutable.
5. FIFO is the inventory costing strategy.
6. Server is authoritative for shared state.
7. POS may continue offline using local projections and allocations.
8. Multi-warehouse fulfillment inside one branch is allowed.
9. Cross-branch fulfillment requires Sales/customer resolution when it changes the deal.
10. No split payment in v1.
11. Organization policies control configurable workflows.
12. Use Outbox/Inbox + idempotency for reliable cross-context processing.


## SaaS Operator Layer

The platform also includes:

- Platform Admin application
- Platform Management Context
- Subscription & Billing Context
- Plans & Entitlements Context
- Tenant Provisioning Context

These contexts manage the SaaS itself and are separate from tenant business operations.
