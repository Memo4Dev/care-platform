# Sales Context

## Owns

- Sale
- SaleItem
- Invoice/Sales document snapshot

## Rules

- Sale != Order != Payment != InventoryTransaction.
- POS Sale records Branch + POS Device + Salesperson.
- Cart is the editable draft; Sale has no `DRAFT` status. Sale lifecycle is
  `PENDING_PAYMENT → COMPLETED | CANCELLED`.
- `PENDING_PAYMENT` establishes immutable Sale, customer, and pricing facts and
  may reference Inventory reservations/allocations, but never consumes final
  stock, FIFO layers, or Inventory ledger entries.
- Completed Sale is immutable.
- `COMPLETED` is entered only after the future Payments completion contract or
  event authorizes Sales completion. It consumes Inventory exactly once through
  Inventory contracts; it is never a cross-context database transaction.
- Cancelling a Sale before completion releases its reservation/allocation and
  creates no final Inventory consumption.
- Price/discount override requires permission + reason + audit.
- Sale uses one payment method in v1; no split payment.
- Invoice/document is created for completed Sale.
- Legal/tax invoice behavior depends on Organization configuration.
- Sale item cost-layer traceability should preserve FIFO cost basis.

## Customer baseline

A Sale may reference an optional `INDIVIDUAL` or `BUSINESS` BusinessCustomer.
Walk-in POS sales have no customer reference. Sales snapshots the facts it needs
for history but does not own Customer persistence or CRM behavior.
