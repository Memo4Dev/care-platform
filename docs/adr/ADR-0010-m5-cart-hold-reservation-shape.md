# ADR-0010: M5 Cart Hold Reservation Shape

Status: Accepted

## Context

ADR-0009 establishes that only an explicit POS Cart hold creates an
Inventory-owned reservation, using an Organization-configurable 15-minute
default TTL. Expiration releases Inventory while retaining the Cart, and resume
must surface shortages without silently recreating a reservation.

The accepted architecture does not yet define several choices needed to
implement that behavior safely:

- a Cart stores `branchId`, but a branch may contain multiple warehouses and no
  default-warehouse rule exists;
- the current Inventory reservation root belongs to one stock position, while a
  Cart may contain multiple variants;
- Cart uses eight-decimal quantities while Inventory persists four decimals;
- the behavior of edits, empty holds, TTL bounds, and shortage-bearing resume is
  unspecified;
- Inventory stores `expiresAt` but has no worker that atomically releases due
  reservations.

These are domain, API, persistence, and concurrency decisions. Implementing
them implicitly would change inventory availability and POS behavior.

## Proposed Decision

### Warehouse scope

`POST /api/v1/pos/carts/{cartId}/hold` requires one explicit `warehouseId` in
its request body. The server verifies that the warehouse is active and belongs
to the Cart's Organization and branch. Every Cart item is reserved from that
warehouse.

M5 does not automatically select a warehouse and does not split one Cart hold
across warehouses. A future POS Device binding may supply a default warehouse,
but it must enter the same validated command boundary.

### Logical hold and Inventory reservation

One Cart hold maps to one Inventory-owned reservation aggregate containing all
Cart demands. Inventory will be expanded additively so each reservation item
references its own tenant-scoped stock position. The existing reservation-root
`stockPositionId` remains temporarily compatible for old single-position rows
and becomes optional for new multi-position reservations.

Inventory receives one atomic batch command. It aggregates demands by stock
position, locks all positions in deterministic order, validates all availability,
and either commits every reservation item or none. Cart never calls Inventory
repositories or mutates Inventory tables.

### Cart lifecycle and editing

Cart remains the sole `DRAFT` aggregate. Hold workflow state is persisted as a
separate Cart-owned record rather than adding Sale-like Cart statuses.

At most one current hold workflow may exist per Cart. Item/customer mutations
are rejected while a hold is pending, active, or releasing. The stored hold is
bound to the exact Cart version it reserved.

Holding an empty Cart is rejected with `VALIDATION_FAILED`.

### Hold and resume workflow

Hold and resume are `WORKFLOW_IDEMPOTENT`:

1. Cart atomically accepts the authenticated command, validates `If-Match`,
   stores the workflow request/checkpoint, and writes an Outbox event.
2. A consumer calls the idempotent Inventory batch contract using the stable
   workflow ID.
3. Cart atomically checkpoints the Inventory result and stores the replayable
   command outcome.

A crash after Inventory commits but before Cart finalization converges by
replaying the same Inventory operation. No transaction spans Cart and Inventory.

Resume releases an active reservation or observes an already released/expired
reservation as convergent success. It returns the Cart to editable Draft state,
rechecks current availability, and returns explicit shortages when present.
Resume never creates or extends a reservation.

### Expiration

Inventory owns both:

- a bounded due-reservation worker using `FOR UPDATE SKIP LOCKED`; and
- lazy expiration when a reservation is checked or released.

Both paths use the same idempotent transition: lock reservation and stock
positions, decrement reserved quantities exactly once, mark `EXPIRED`, append
Inventory ledger/outbox effects, and commit atomically.

### Organization policy

Add the Organization policy type:

```text
CART: { holdReservationTtlMinutes: 15 }
```

The proposed accepted range is a positive whole number from 1 through 1440
minutes. Each hold snapshots the resolved TTL and policy version; later policy
changes do not alter existing holds.

### Quantity precision

Catalog converts each Cart item quantity to the variant base unit before the
Inventory command. Inventory quantity persistence is expanded to eight decimal
places without reducing its current integer capacity. A conversion that cannot
be represented exactly at that scale is rejected; quantities are never silently
rounded for reservation.

### API and authorization

Add only:

```text
POST /api/v1/pos/carts/{cartId}/hold   body: { warehouseId }
POST /api/v1/pos/carts/{cartId}/resume bodyless
```

Both require `PosOperatorGuard`, `sales.create`, Organization/branch access,
`Idempotency-Key`, and `If-Match`. Caller-supplied tenant, actor, device, role,
or permission authority remains forbidden.

## Alternatives

- **Automatically choose a branch warehouse:** rejected in the proposal because
  no accepted default or priority rule exists and a wrong choice changes stock
  availability.
- **Allow per-item or multi-warehouse selection:** deferred because it changes
  fulfillment behavior and substantially expands POS interaction and conflict
  handling.
- **Create one current Inventory reservation per Cart item:** rejected because a
  later shortage could leave a partially held Cart unless Inventory introduces
  a separate atomic reservation group.
- **Add `HELD` directly to Cart status:** rejected in the proposal because the
  accepted architecture defines Cart as the editable Draft and does not define a
  Cart business-status lifecycle.
- **Call Inventory synchronously while holding a Cart database transaction:**
  rejected because it couples context transactions, risks pool/lock contention,
  and leaves unsafe crash windows.
- **Round converted quantities to Inventory's existing four decimals:** rejected
  because it can over- or under-reserve stock silently.
- **Permit zero TTL to disable holding:** rejected in the proposal because it
  contradicts the explicit Hold command and creates ambiguous immediate-expiry
  behavior.

## Consequences

- M5-005 requires additive Cart, Inventory, and Organization persistence changes.
- Inventory gains an atomic multi-position reservation contract and a real
  expiration path.
- Cart gains durable hold workflow/checkpoint state without owning Inventory
  reservation rows.
- Explicit single-warehouse selection keeps M5 deterministic and compatible
  with later POS Device defaults.
- Real PostgreSQL tests must cover partial-failure rollback, concurrent oversell,
  expiration/release races, workflow crash replay, tenant/branch/warehouse
  isolation, and exact quantity conversion.
- Redis/BullMQ delivery remains a required CI gate for the workflow consumer.

## Security

- Warehouse IDs are candidate resources only; server-side Organization and
  branch validation remains authoritative.
- Inventory operations are tenant-scoped and reference the stable Cart hold
  workflow, never caller identity fields.
- Idempotency scopes include authenticated actor, Organization, operation, Cart,
  expected version, and warehouse where applicable.
- Public responses expose Cart hold state, expiry, and shortages, not Inventory
  ledger/cost internals.

## Compatibility

All schema changes use expand-first additive migrations. Existing Draft Carts
and single-position Inventory reservations remain readable. Contract additions
are additive. Multi-warehouse holds, POS Device warehouse defaults, and offline
allocation remain deferred.
