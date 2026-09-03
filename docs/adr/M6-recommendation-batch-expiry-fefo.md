# M6 Implementation Recommendation: Batch/Lot Expiry + FEFO + No-Expired-Sale

Status: Recommendation (not a decision; companion to ADR-0013)

Scope: This document recommends **when** and **how** to implement the
Batch/Lot expiry feature at the start of Milestone 6 (M6 Operations: Orders,
Fulfillment, Returns, Delivery). It does not implement anything and does not
change the schema or code.

Prerequisite decision: ADR-0013 is **accepted**. Before M6 implementation, this
feature must be broken into explicit tasks covering, at minimum:
batch/lot persistence, GoodsReceipt capture, Inventory availability, FEFO
selection, FIFO-cost compatibility, Sales completion integration,
adjustments/disposal, expiry reporting, BullMQ notifications, offline
compatibility, migrations/backfill strategy, and tests.

---

## Why M6, and not M5 or earlier

M6 is the natural entry point because the feature is deeply entangled with the
flow that M6 introduces (orders → reservation → fulfillment → picking →
returns). Details:

1. **Picking / Fulfillment is the factory of the FEFO rule.**
   `20-fulfillment.md` says picking chooses stock and shortage-search moves
   across warehouses in the same Branch. That is exactly where _"sell the
   non-expired batch, nearest-expiry first"_ must act. Implementing expiry
   before M6 would require re-touching fulfillment later.

2. **Returns already carry an InventoryDisposition model.**
   `23-returns.md` defines `RESTOCK / DAMAGED / QUARANTINE / WRITEOFF`.
   Expired stock is naturally a `WRITEOFF`, so expiry/wastage management slots
   into an existing decision rather than inventing a new one later.

3. **Orders touch reservation and cancellation.**
   `18-orders.md` requires reservation revalidation on quantity changes and
   release on cancel. The no-expired-sale rule must hold across online order
   reservation, not just POS. Building it in M6 covers both POS and online
   order paths from the same Inventory rule.

4. **M5 is not yet materially stable/merged.**
   Current state is `M5 IN PROGRESS` on `feat/m5-sales-pos-core` (M5-007
   recently landed; work unpushed/unmerged). Adding a cross-cutting expiry
   stream to active POS/sale work risks contaminating an unmerged branch.

---

## Recommended execution order at the start of M6

Do the additive schema + domain work as the **first dedicated Inventory
track** of M6, before or in parallel with Orders/Fulfillment, and **before**
any fulfillment picking logic that consumes stock. Suggested sequence:

1. **Stage A — Catalog flag (additive).**
   - Add `catalog.product_variants.has_expiry BOOLEAN NOT NULL DEFAULT FALSE`.
   - No other change. Existing variants unaffected.

2. **Stage B — Inventory FIFO layers carry expiry (additive).**
   - Add `inventory.fifo_layers.expiry_date DATE NULL` and
     `inventory.fifo_layers.batch_ref TEXT NULL`.
   - Keep `unit_cost` / `remaining_quantity` and the FIFO costing logic
     untouched.

3. **Stage C — Receipt captures batch expiry (Purchasing -> Inventory).**
   - GoodsReceipt line for a `has_expiry = TRUE` variant requires an expiry
     date; create the layer with `expiry_date` (and optional `batch_ref`).

4. **Stage D — FEFO-aware physical selection + hard no-expired-sale rule**
   **(inside `InventoryService`).**
   - Exclude expired layers from sellable availability.
   - Among valid layers, select nearest-expiry-first for consumption while
     FIFO continues to attribute cost.
   - Reject any sale/reservation/consumption of an expired batch at the domain
     layer, with no override from UI or offline client.

5. **Stage E — Organization policy (additive).**
   - Add `POLICY_TYPES` value `EXPIRY` (versioned, existing pattern) with e.g.
     `{ posExpiryWarningEnabled: boolean, warningLeadDays: number }` for POS
     warning visibility only — never an override of the hard rule.

6. **Stage F — Wastage + scheduler + alerts + reports.**
   - Record expired write-offs via existing `stock_adjustments` with a clear
     reason (`EXPIRED`/`WASTAGE`), and align with Returns `WRITEOFF`
     disposition where expiry causes the return.
   - Add the near-expiry BullMQ scheduler job (e.g. 30-day lead) and alert
     events through the existing Outbox/event pipeline.

7. **Stage G — Contracts + endpoints + tests.**
   - Extend Inventory contracts for expiry in the FEFO-availability/quote
     projections and in batch-creation commands (additive).
   - Add boundary tests: expired-sale rejection, FEFO selection, receipt
     capturing expiry into layers, unit/carton sale, cross-tenant isolation,
     offline→sync convergence of the no-expired-sale rule, and expiry alert
     scheduling.

---

## Hard requirements for M6 implementation

- **Additive only.** Every change is expand-first; no column/constraint/query
  that exists today is rewritten or removed. FIFO costing stays authoritative.
- **Rule lives in Inventory domain, not UI.** UI is only a view; the server
  rejects expired sales even when POS ran offline and syncs later.
- **FIFO costing preserved.** FEFO is physical batch selection only; it never
  changes cost attribution.
- **All M6 quality gates green** (typecheck, lint, format, unit, native-PG
  integration, and CI Redis/BullMQ job gate) before acceptance.

---

## Ordering interaction with M6 contexts

| M6 context  | Interaction with expiry feature                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| Orders      | Reservation must exclude expired batches; cancellation/quantity change revalidates against valid stock  |
| Fulfillment | Picking + shortage-search must honor FEFO and never pick expired                                        |
| Returns     | Expiry-induced returns map to `WRITEOFF` disposition; return cost basis stays from original FIFO layers |
| Delivery    | No direct change; expiry remains Inventory-owned and surfaces via the chosen batch                      |

---

## What is explicitly out of scope for this M6 work

- Per-unit serialized (EPC-level) expiry tracking.
- Supplier batch attributes beyond `expiry_date`/`batch_ref`/`manufacture_date`.
- Automated aged write-off jobs beyond the near-expiry alert.
- Any change to Storefront or Mobile in this track (Storefront/Mobile deferred).

---

## Final gate before M6 work begins

1. ADR-0013 is accepted by the human owner (architect/business).
2. M5 (Sales & POS Core) is merged and its branch closed.
3. This recommendation is reviewed alongside ADR-0013 by the independent
   reviewer; any conflict with `00-overview.md` rule #5 (FIFO costing) is
   resolved in the ADR before code.
