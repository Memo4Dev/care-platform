# ADR-0013: Batch/Lot Expiry with FEFO Physical Selection while Preserving FIFO Costing

Status: Accepted

> **Approval scope (authoritative).** This ADR is accepted as an architectural
> decision only. It does **not** authorize implementation during M5. M5 remains
> scoped to its existing Sales/POS completion work. Implementation is scheduled
> after M5 is fully completed/merged, during the appropriate M6 workstream, and
> must first be broken into explicit tasks (see the M6-recommendation break-down).
>
> Recorded boundary facts:
>
> - **Expiry belongs to Batch/Lot inventory received through GoodsReceipt**, never
>   placed directly on the Product/Variant as the stock expiry source. A variant
>   carries only `has_expiry` to signal that batch expiry tracking is required.
> - **Expired stock is NEVER sellable.** Backend/domain enforcement is mandatory
>   and remains enforceable for offline POS reconciliation. No user/manager
>   override may allow selling expired stock.
> - **FEFO (physical selection/fulfillment) and FIFO (inventory costing) remain
>   independent**; FEFO must not replace FIFO costing, and the costing model is
>   not rewritten merely to implement expiry.
> - **Expired/wasted stock leaves inventory through the existing audited
>   adjustment/ledger mechanisms** with explicit reasons (`EXPIRED`, `WASTAGE`);
>   expired stock is never silently deleted.
> - **EXPIRY organization policy** is configurable UX/operational behavior only
>   (warning visibility/window, default near-expiry horizon **30 days**, made
>   configurable when implemented). It never provides an expired-stock sale
>   override.
> - **Scheduler**: near-expiry detection/notification may use BullMQ when
>   implemented; notification generation stays separate from the hard domain
>   rule that expired stock cannot be sold.

## Context

The platform sells physical goods, some of which have a real expiry date
(e.g. perishables). The current Catalog (`catalog.product_variants`) and
Inventory (`inventory.fifo_layers`) do not model expiry dates or batches, and
the accepted architecture in `00-overview.md` states only:

> FIFO is the inventory costing strategy.

Business requirements collected from stakeholders:

- One product variant may be held under several different expiry dates at the
  same time (multiple incoming batches).
- Expiry is known at the moment a batch is received from a supplier
  (GoodsReceipt), not at Catalog definition time.
- Expired product must never be sold, with no override by any actor.
- Expired product is treated as loss/wastage and recorded as an Inventory
  adjustment.
- Operators want an alert for product nearing expiry (e.g. within 30 days).
- Some products have no expiry (e.g. electronics); expiry is optional and is
  enabled per variant.
- Goods may be sold by unit or by carton/box (unit conversion).
- POS scans by barcode/search and must sell the non-expired (valid) stock.
- A near-expiry warning in POS is governed by Organization policy (enable /
  disable the warning), never an override of the hard no-expired-sale rule.

Deciding this implicitly would change inventory availability, sale behavior,
and POS flows. This ADR records the decision so it is explicit and reviewable
before any implementation.

## Decision

Introduce an additive **Batch/Lot with Expiry** model in the Inventory context
while preserving the existing FIFO **costing** logic unchanged.

### Expiry enablement per variant (Catalog)

- Add an optional additive column to `catalog.product_variants`:
  `has_expiry BOOLEAN NOT NULL DEFAULT FALSE`.
- When `has_expiry = TRUE`, receiving a batch for that variant requires an
  expiry date (and optionally batch reference / manufacture date).
- When `has_expiry = FALSE`, no expiry is captured and existing FIFO costing
  and consumption behavior is unchanged.
- This is a variant-level flag (option "A" selected by stakeholders), not a
  global or category-level toggle, giving per-product flexibility.

### Batch/Lot on receipt (Purchasing -> Inventory)

- Expiry is not a Catalog field; it is captured at GoodsReceipt time.
- Each accepted receipt line whose variant `has_expiry = TRUE` creates a batch
  carrying: `expiry_date`, optional `batch_ref`, optional `manufacture_date`.
- One batch has a single expiry for all its units (all cartons/boxes from the
  same received batch share the same expiry); there is no intra-batch expiry
  splitting.

### FIFO layers carry expiry (additive)

- Add optional additive columns to `inventory.fifo_layers`:
  `expiry_date DATE NULL` and `batch_ref TEXT NULL`.
- The existing cost columns (`unit_cost`, `quantity`, `remaining_quantity`)
  and the expiry-independent FIFO **costing** logic are **unchanged**.

### FIFO costing preserved; FEFO for physical selection

- **Costing stays FIFO**: because unit price may differ between invoices, cost
  is derived from the oldest-received layers first exactly as today. This
  decision does not change profit/cost calculations.
- **Physical selection follows FEFO for valid stock**: when reserving or
  consuming for sale, the system selects non-expired layers first and, among
  those, layers nearest expiry first. Expired layers are excluded from
  sellable availability.
- These two are compatible: FIFO governs cost attribution, FEFO governs which
  physical batch is picked for sale. The ADR makes this coexistence explicit so
  a layer may be consumed physically out of strict FIFO chronological order for
  costing.
- Implemented inside `InventoryService`'s selection logic alongside the
  existing cost logic; it does not rewrite the costing queries or immutable
  ledger rules.

### Hard no-expired-sale rule (domain, not UI)

- A sale/reservation/consumption of an expired batch is rejected by the
  backend domain rule with no override by any actor, regardless of UI, offline
  operation, or POS path. The rule lives in Inventory, not in a client.
- The UI cannot be the only guard because the POS may operate transiently
  offline and must converge to the same authority on sync; the server remains
  authoritative for sale decisions.

### Wastage / expiry adjustments

- Expired stock is recorded as loss via the existing `inventory.stock_adjustments`
  using a clear `reason` (e.g. `EXPIRED` / `WASTAGE`). The adjustment table
  itself is unchanged; only usage/reason values are extended.
- Supports bulk/aged manual or scheduler-driven write-off.

### Expiry alert + scheduler

- Reuse the existing BullMQ/background-job infrastructure to add a bounded
  job for nearing-expiry detection (e.g. within 30 days) generating alert
  events/reports. No new infrastructure.
- Add Inventory domain events such as `BatchReceived`, `StockExpired`,
  `ExpiryAlert` through the existing Outbox/event pipeline.

### Organization policy for POS warning (additive)

- Add a new `PolicyType` (e.g. `EXPIRY`) to the existing versioned
  `organization.organization_policies`, carrying a JSON value such as:
  `{ posExpiryWarningEnabled: true, warningLeadDays: 30 }`.
- Policy controls only whether/lead-time the POS **warning** appears. It never
  permits selling expired stock; the hard rule above remains absolute.

### Sale by unit or carton

- Expiry lives at the batch/delivery level; sale quantity converts using the
  existing unit-conversion rules. The batch expiry applies uniformly to all
  units/cartons from that batch.

## Alternatives

- **Add an `expiry_date` column directly on `catalog.products` /
  `product_variants`:** rejected because the same variant may legitimately hold
  multiple batches with different expiry dates, and because expiry is known at
  receipt time, not catalog-definition time. A single product-level value would
  be wrong for real multi-batch stock.
- **UI-only enforcement of the no-expired-sale rule:** rejected because the POS
  can operate transiently offline and the architecture requires the server to
  be authoritative for shared/sale state. UI-only is not sufficient.
- **Replace FIFO costing with FEFO costing:** rejected. Stakeholders require
  FIFO costing because unit price can vary per invoice; changing cost strategy
  would distort margins.
- **Full dynamic batch/lot serialized tracking (per-unit expiry):** deferred as
  over-scoped for v1; a single expiry per received batch is sufficient.
- **Global or category-level expiry enablement:** rejected in favor of the
  stakeholder-selected per-variant flag for flexibility.

## Consequences

- Additive, expand-first migrations only: new columns on `product_variants`
  and `fifo_layers`, plus a new `organization_policies` `EXPIRY` type and any
  new Inventory domain events. No existing column, constraint, query, or
  consumer is removed or rewritten.
- Existing variants with `has_expiry = FALSE` and existing FIFO layers remain
  fully readable and cost correctly with no expiry.
- Inventory selection logic gains an FEFO-aware physical-selection path while
  keeping FIFO costing untouched.
- New tests must cover: expired-sale rejection at the backend, FEFO physical
  selection, receipt capturing expiry into layers, unit/carton sale, cross-tenant
  isolation, offline->sync convergence of the no-expired-sale rule, and expiry
  alert scheduling.
- Expiry/wastage adjustments and near-expiry reports are enabled without
  changing the existing adjustment table or worker infrastructure.

## Security

- The no-expired-sale rule is enforced in the trusted Inventory domain, never
  trusted to UI or client-supplied flags.
- Expiry and batch data are tenant-scoped and returned through established
  Inventory contracts; ledger/cost internals remain internal.
- Policy changes are versioned per `10-organization.md`; completed transactions
  are never rewritten by later policy changes.

## Compatibility

- All schema changes are additive (expand-first). Disabled expiry keeps all
  current Catalog/Inventory behavior and contracts unchanged.
- The FIFO costing decision in `00-overview.md` rule #5 is preserved; this ADR
  refines it to state that FIFO governs cost while FEFO governs physical batch
  selection for valid stock.
- Contract additions (expiry in receipts, expiry in FIFO layer projections,
  new policy type, new domain events) are additive.
- Full batch-serialized per-unit expiry, supplier batch attributes beyond the
  above, and automated aged write-off remain deferred.
