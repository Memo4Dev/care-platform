# Refactor & Migration Strategy

## Strategy

Use a Strangler-style migration inside the monorepo.

```text
Legacy flow
   ↓
New module boundary
   ↓
New implementation takes ownership
   ↓
Legacy route/table path disabled
```

## Step 1 — Discover current ownership

For every current feature, classify:

```text
Legacy endpoint
Legacy table
Current owner module
Target bounded context
Migration status
```

## Step 2 — Stop architectural leakage

Introduce repository/service boundaries around current DB access before replacing internals.

Example:

```text
Controller
  ↓
InventoryApplicationService
  ↓
InventoryRepository
```

instead of direct SQL from controllers.

## Step 3 — Build new module beside legacy

Example:

```text
legacy inventory
new inventory module
```

Route a limited path/feature flag to new module.

## Step 4 — Dual-read / controlled compare when useful

For derived/read data only:

```text
legacy result
vs
new projection result
```

Report mismatches.

Avoid dangerous dual-write for money/stock unless carefully designed.

## Step 5 — Move write ownership

One system becomes authoritative.

```text
new Inventory = source of truth
legacy inventory quantity write disabled
```

## Step 6 — Backfill

Backfill historical data into:
- ledgers
- snapshots
- projections

Use explicit migration scripts with reconciliation.

## Step 7 — Remove legacy path

Only after:
- traffic moved
- reconciliation passes
- rollback window ends
- no active dependency remains

## Non-negotiable

Never migrate critical financial/inventory state without reconciliation reports.
