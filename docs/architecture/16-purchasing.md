# Purchasing Context

## Owns
- Supplier
- PurchaseOrder
- PurchaseOrderItem
- GoodsReceipt
- GoodsReceiptItem
- Additional purchase costs

## Rules
- Multiple POs for same Supplier + Variant are allowed.
- PO has independent identity.
- Approval is configurable by organization/role.
- Partial receipt is policy-driven.
- Over-receipt is policy-driven.
- GoodsReceipt is separate from PurchaseOrder.
- Only accepted received quantity enters Inventory.
- Confirmed GoodsReceipt is immutable.
- Optional costs (shipping/customs/handling/other) feed Actual Cost.
- Actual Cost feeds Inventory FIFO layers.
