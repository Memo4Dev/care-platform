# Orders Context

## Owns
- Order
- OrderItem
- Order lifecycle/status history

## Typical online flow
Draft → Submitted → UnderReview → Approved → Reserved → Processing → Ready → Completed

## Rules
- Order stores pricing/customer/address snapshots.
- State transitions are explicit.
- Order modification after approval follows policy.
- Quantity/item modifications require reservation revalidation.
- Cancellation after reservation triggers release.
- Cancellation after payment may trigger Refund workflow.
- Order does not directly mutate Inventory, Payments or Delivery.
