# Sales Context

## Owns
- Sale
- SaleItem
- Invoice/Sales document snapshot

## Rules
- Sale != Order != Payment != InventoryTransaction.
- POS Sale records Branch + POS Device + Salesperson.
- Completed Sale is immutable.
- Price/discount override requires permission + reason + audit.
- Sale uses one payment method in v1; no split payment.
- Invoice/document is created for completed Sale.
- Legal/tax invoice behavior depends on Organization configuration.
- Sale item cost-layer traceability should preserve FIFO cost basis.
