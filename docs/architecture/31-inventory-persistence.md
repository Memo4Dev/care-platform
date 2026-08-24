# Inventory Persistence

Core tables:

```text
inventory.stock_positions
inventory.ledger_entries
inventory.fifo_layers
inventory.reservations
inventory.reservation_items
inventory.allocations
inventory.stock_transfers
inventory.stock_transfer_items
inventory.stock_adjustments
```

## Critical constraints

stock_positions:
UNIQUE (organization_id, warehouse_id, variant_id)

CHECK:
on_hand >= 0
reserved >= 0
allocated >= 0
reserved + allocated <= on_hand

## FIFO index

```text
(organization_id, warehouse_id, variant_id, received_at, id)
WHERE remaining_quantity > 0
```

FIFO consumption transaction:

```text
BEGIN
1. lock StockPosition
2. validate reservation/allocation/availability
3. lock oldest FIFO layers
4. consume layers
5. update StockPosition
6. insert immutable Ledger entries
7. write Outbox events
COMMIT
```

Reservation creation uses row locking to prevent concurrent overselling.
