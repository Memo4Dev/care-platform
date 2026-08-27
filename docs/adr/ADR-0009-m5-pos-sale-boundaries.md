# ADR-0009: M5 POS Sale Boundaries

Status: Accepted

## Context

M5 introduces editable POS carts and immutable sales while Inventory and future
Payments remain separate bounded contexts. The architecture previously required
reservation at checkout but did not define the POS draft-cart reservation trigger
or the point at which a Sale consumes inventory.

## Decision

- A normal POS Draft Cart never reserves inventory; it performs availability
  checks only.
- Holding a Cart creates an Inventory-owned reservation with a default 15-minute
  TTL. The TTL is an Organization Policy. Expiration releases stock using
  Inventory's existing expiration mechanism while the Cart remains persisted.
- Resuming an expired held Cart rechecks availability and surfaces shortages. It
  never silently recreates a reservation when stock is unavailable.
- Cart is the sole editable draft. Sale has no `DRAFT` status. Its lifecycle is
  `PENDING_PAYMENT → COMPLETED | CANCELLED`.
- `PENDING_PAYMENT` persists immutable sale and pricing facts and uses
  Inventory reservations/allocations where required, but never consumes stock
  or FIFO layers.
- Only `COMPLETED`, triggered by a future Payments completion contract/event,
  consumes Inventory exactly once. M5 provides a non-provider test/application
  completion path that invokes this same transition.
- A pre-completion cancellation releases the associated Inventory reservation or
  allocation and never creates final stock consumption.
- Sales owns Cart, Sale lifecycle, and sale snapshots; Inventory owns
  reservation, allocation, consumption, FIFO, and its ledger; Payments will own
  payment attempts and provider success/failure.
- M5 adds a narrow Customers baseline: `INDIVIDUAL` and `BUSINESS` customers can
  be created, read, searched, and referenced from carts/sales. Customer remains
  optional for walk-in POS sales.

## Alternatives

- Reserve every draft-cart mutation: rejected because abandoned carts would
  unnecessarily reduce sellable stock.
- Consume inventory at `PENDING_PAYMENT`: rejected because an unsuccessful or
  absent payment must not create final FIFO/ledger effects.
- Model Sales with a separate `DRAFT` state: rejected because Cart is already
  the editable draft aggregate.
- Add Payments/Cash provider logic to M5: rejected because that would violate
  bounded-context ownership and prematurely define finance behavior.

## Consequences

- Hold/resume and sale completion require idempotency and real PostgreSQL
  concurrency coverage.
- The completion workflow must be a durable local Sales process coordinated by
  Outbox/Inbox contracts, never a cross-context database transaction.
- A future Payments context must provide a stable payment-completion reference
  so Sales can deduplicate completion and preserve correlation/causation.
- Customer addresses, credit, loyalty, segmentation, and customer ledgers stay
  out of M5.

## Security

- Availability, reservation, completion, and cancellation remain
  organization/branch/warehouse scoped.
- A payment completion signal is trusted only from the future Payments contract
  or authenticated internal event consumer; callers cannot claim payment success
  through a public POS endpoint.
- Manager approvals retain `performedBy` (cashier) and `approvedBy` (manager)
  when a future override requires them.

## Compatibility

The decision is additive. Existing Inventory reservation expiration and FIFO
contracts remain authoritative. Future offline POS synchronization retains its
separate allocation/conflict workflow.
