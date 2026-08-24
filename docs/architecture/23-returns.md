# Returns Context

## Owns
- Return
- ReturnItem
- ReturnInspection
- InventoryDisposition decision

## Rules
- Return references Sale.
- Partial returns are allowed.
- Cannot return more than remaining returnable quantity.
- Return window/approval/inspection are Organization Policy.
- Override requires permission + reason.
- Return does not directly mutate Inventory or Wallet/Debt.
- Returned FIFO cost basis comes from original Sale cost layers.

## Inventory dispositions
RESTOCK
DAMAGED
QUARANTINE
WRITEOFF
