# Offline Persistence

## Server tables

```text
offline.device_sequences
offline.operations
offline.conflicts
```

Important constraints:

```text
OperationId globally unique
UNIQUE (organization_id, device_id, sequence_number)
```

## POS local database

```text
local_products
local_variants
local_prices
local_customers
local_inventory_projection
local_allocations
local_carts
local_sales
local_operations
local_sync_queue
local_sync_state
```

POS uses UUIDv7 locally.

Sync contract concept:

```text
Request:
device_id
last_server_checkpoint
operations[]

Response:
accepted[]
rejected[]
conflicts[]
new_checkpoint
projection_updates[]
```

Ordering guarantee is per device, not global.
