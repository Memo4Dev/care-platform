# Workstream Plan

Parallel work is allowed only when dependencies are clear.

## Workstream A — Platform
- tenancy
- identity
- subscription
- entitlements
- admin

## Workstream B — Commerce Core
- catalog
- pricing
- customers
- cart
- sales/orders

## Workstream C — Inventory & Purchasing
- inventory
- FIFO
- reservations
- transfers
- purchasing

## Workstream D — Finance
- payments
- wallet
- credit
- cash
- returns financial effect

## Workstream E — Operations
- fulfillment
- delivery
- returns inspection

## Workstream F — Channels
- POS
- Storefront
- Mobile

## Workstream G — Platform Engineering
- CI/CD
- observability
- security
- migrations
- testing
- infrastructure

## Rule

A workstream cannot invent duplicated domain behavior because its dependency is unfinished.

Use mocks/contracts only at module boundary, then integrate against real provider.
