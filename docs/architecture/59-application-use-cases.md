# Application Use Cases

Application layer coordinates authorization, policies, aggregate loading, commands, persistence and events.

## Example: Complete POS Sale

```text
1. authenticate user/device
2. authorize sales.complete in branch
3. load Sale aggregate
4. load applicable organization policy
5. validate one payment method
6. command Sale.Confirm/Complete
7. commit Sale + Outbox
8. process manager coordinates:
   - Payment
   - Inventory consumption
   - Cash movement if CASH
   - Invoice issuance
9. expose final workflow status
```

## Example: Approve Online Order

```text
1. authorize order.approve
2. load Order
3. verify Reservation still valid
4. approve Order
5. Outbox OrderApproved
6. Fulfillment creates plan
```

## Example: Confirm Goods Receipt

```text
1. authorize purchasing.receive
2. load GoodsReceipt
3. apply over/partial receipt policy
4. calculate accepted quantities
5. calculate actual allocated cost
6. confirm GoodsReceipt
7. Outbox StockReceiptRequested
8. Inventory ReceiveStock
9. FIFO layers created
```

## Example: Complete Return

```text
1. validate Sale/returnable quantities
2. evaluate Return Policy
3. inspect if required
4. choose inventory disposition
5. accept Return
6. request Inventory effect
7. RefundResolver decides debt/wallet/original payment
8. Payments performs refund
9. Return becomes completed when required effects succeed
```

## Example: Resolve Offline Conflict

```text
1. authorize offline.resolve
2. load conflict
3. ensure unresolved
4. try/review system recommendations
5. execute selected domain resolution
6. emit conflict resolution event
7. audit user/reason
```
