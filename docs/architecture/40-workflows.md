# Cross-Context Workflows

## Online Checkout

```text
Cart
→ Pricing validation
→ Inventory reservation
→ Fulfillment plan
→ Delivery quote
→ Customer confirmation
→ Order
→ Review/Approval
→ Payment
→ Fulfillment
→ Delivery/Pickup
→ Sale/Invoice
```

## POS Online Sale

```text
POS Cart
→ Pricing
→ Availability / Hold Reservation
→ Sale (PENDING_PAYMENT snapshot)
→ Payment completion contract
→ Inventory consumption / FIFO
→ Cash movement if CASH
→ Completed Sale / Invoice
```

## POS Offline Sale

```text
Local Cart
→ Local Allocation
→ Local Sale
→ Sync Queue
→ Server Validation
→ Accepted OR Conflict
→ same-branch recovery
→ Manager/Sales resolution if needed
```

## Purchase

```text
PO
→ Goods Receipt
→ Actual Cost
→ Inventory ReceiveStock
→ FIFO Layer
```

## Return

```text
Sale
→ Return eligibility
→ Approval/Inspection
→ Inventory disposition
→ Refund Resolver
→ Debt/Wallet/Original Payment
```

## Transfer

```text
Approve
→ Dispatch
→ Source Stock -
→ InTransit
→ Receive
→ Destination Stock +
```
