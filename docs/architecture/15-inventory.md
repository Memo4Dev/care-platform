# Inventory Context

## Owns
- StockPosition
- InventoryLedger
- FIFOLayer
- Reservation
- StockAllocation
- StockTransfer
- StockAdjustment

## Identity
StockPosition = Organization + Branch + Warehouse + Variant

## Core formula
Available = OnHand - Reserved - Allocated

## Rules
- No direct stock quantity edits.
- Inventory Ledger is immutable.
- FIFO is mandatory.
- Reservations reduce Available.
- Allocations reduce Available.
- Transfers stay InTransit until destination receipt.
- Destination stock increases only after receipt.
- Offline allocation overflow does not silently reduce central stock.
- Adjustments require reason and audit.

## Offline conflict resolution
OfflineSaleConflictDetected
→ automatic same-branch recovery first
→ ManagerResolutionRequired
→ TransferStock | PartialFulfillment | CancelSale | ApproveWithAdjustment
