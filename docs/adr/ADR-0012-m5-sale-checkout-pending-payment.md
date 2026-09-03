# ADR-0012: M5 Sale Checkout to Immutable `PENDING_PAYMENT`

Status: Accepted

## Context

ADR-0009 established the M5 POS boundary: Cart is the sole editable draft,
Sale has no `DRAFT` state, `PENDING_PAYMENT` stores immutable sale facts, and
only a later trusted completion boundary consumes Inventory/FIFO exactly once.
M5-004 through M5-006 then implemented persisted POS Draft Carts, hold/resume
reservations, and live Pricing/availability reads. The remaining M5 Sales slice
needs the exact checkout behavior, Sale persistence shape, Cart terminalization,
authorization, idempotency, reservation ownership, and the trusted
payment-completion boundary recorded before implementation.

These decisions are hard to reverse because they define the Sales aggregate,
database shape, POS API behavior, and the exact Inventory/Sales handoff used by
future Payments. Implementing them implicitly would risk double checkout,
mutable historical pricing, cross-context leakage, or incorrect reservation and
FIFO consumption.

## Decision

### 1. Aggregate and lifecycle

- Sales owns an immutable `Sale` aggregate and immutable `SaleItem` snapshot
  facts.
- Sale lifecycle is exactly:

  ```text
  PENDING_PAYMENT → COMPLETED | CANCELLED
  ```

- There is no Sale `DRAFT` state. Cart remains the only editable draft.
- `PENDING_PAYMENT` must already reference an active Inventory
  reservation/allocation for the demanded stock, but it must not consume final
  stock, FIFO layers, or the final Inventory sale ledger effect.
- `COMPLETED` is entered only through the trusted Sales completion boundary
  after a future Payments success signal. A normal public POS cashier request
  cannot assert payment success.

### 2. Checkout command and Cart eligibility

- `POST /sales` creates a new immutable Sale in `PENDING_PAYMENT` from one
  existing POS Cart and requires the Cart's expected optimistic `version`.
- Eligible Cart states:
  - `DRAFT`: checkout performs a fresh authoritative Pricing re-evaluation and
    a fresh Inventory reservation/allocation attempt before accepting the Sale.
    A prior hold is not required. When no reusable held reservation exists,
    checkout requires one explicit `warehouseId`; there is no automatic
    warehouse selection and no multi-warehouse split.
  - `HELD` equivalent workflow state: checkout reuses or associates the current
    valid Inventory reservation where compatible and must not create a duplicate
    reservation for the same demand.
- If a held reservation is expired, missing, incompatible, or otherwise not
  reusable, checkout falls back to fresh stock validation and reservation.
  Failure returns explicit shortages and creates no Sale.
- Reservation establishment for checkout is all-or-nothing. If all demanded
  stock cannot be reserved atomically, checkout fails and no partial Sale,
  partial reservation, or terminal Cart transition is committed.
- When checkout reuses a valid held reservation, the caller does not need to
  resend `warehouseId`; the authoritative warehouse is derived from the active
  reservation. A conflicting caller-supplied `warehouseId` is rejected.
- Checkout of the same Cart/version must not create multiple Sales, regardless
  of retries or parallel requests.

### 3. Cart terminalization and traceability

- After successful checkout the source Cart is no longer editable as an active
  Draft and is preserved for traceability.
- The Cart terminal status for this state is `CHECKED_OUT`.
- The Cart is never deleted as part of checkout.
- Sales persists `cartId` and Cart persists the terminal state so the history is
  traceable `Cart → Sale` without requiring mutable external reconstruction.
- `CHECKED_OUT` is a terminal Cart status used only after a successful Sale is
  created. Hold workflow state remains separate; this ADR does not turn active
  holding into a Cart business status.
- When a held Cart is checked out, the Cart hold workflow row is terminalized to
  `CHECKED_OUT` (an additive hold status, migration `0033`) and its TTL cleared.
  The hold stays traceable, but current-hold reads (and the current-hold partial
  unique index) only match `PENDING | ACTIVE | RELEASING`, so a checked-out Cart
  does not surface a stale `ACTIVE` hold or appear to remain reserving stock.

### 4. Authoritative pricing freeze

- Checkout never trusts client-submitted price totals and never blindly reuses a
  previously returned quote.
- The M5-006 quote endpoint remains informational and non-mutating.
- Checkout re-evaluates pricing server-side through the authoritative Pricing
  contract using the Cart's current items, branch, channel `POS`, chosen price
  type, and optional customer context.
- The resulting authoritative quote is frozen into Sale and SaleItem snapshot
  fields at checkout.
- If the price changed since the user last viewed the Cart, checkout uses the
  current authoritative quote and returns the resulting frozen Sale snapshot.
  M5 does not add a separate user-confirm-price-change workflow.

### 5. Sale persistence shape

- M5 adds the Sales persistence roots:

  ```text
  sales.sales
  sales.sale_items
  ```

- `sales.sales` must include, at minimum:
  - `id`
  - `organization_id`
  - `branch_id`
  - nullable reservation/warehouse reference fields required by the checkout
    reservation scope
  - nullable `customer_id` reference
  - authenticated salesperson/operator identity
  - nullable trusted POS device reference when available
  - `cart_id`
  - server-generated `sale_number`
  - `status`
  - frozen pricing totals
  - `currency`
  - `created_at`
  - nullable `completed_at`
  - nullable `cancelled_at`
  - reservation/reference metadata required for Inventory traceability
  - correlation/causation/audit fields following repository conventions
  - aggregate `version` if the implementation convention requires it
- `sales.sale_items` must snapshot, at minimum:
  - `variant_id`
  - `product_id` where available/required
  - product/variant display name snapshot label
  - `sku` and `barcode` where relevant
  - `unit_id`
  - exact line quantity
  - base-unit quantity and base-unit reference where required for Inventory
    traceability
  - unit price
  - line subtotal
  - discount facts
  - tax facts when available
  - final line total
  - `currency`
  - pricing source/reference metadata when useful
- Money and quantity values use the repository's decimal-string-safe
  conventions. JavaScript floating-point math is forbidden for correctness-
  critical Sale totals.
- `sale_number` is generated server-side and unique per organization. The caller
  cannot supply the authoritative Sale number.

### 6. Authorization and trusted identities

- `POST /sales` uses the existing M5 transitional POS boundary:
  `PosOperatorGuard` with a trusted server-resolved `ORGANIZATION_USER`.
- Authorization for checkout reuses `sales.create` unless the authoritative
  permission registry already provides a narrower accepted capability.
- `GET /sales/{saleId}` uses the authoritative sales read capability.
- `POST /sales/{saleId}/cancel` uses the existing `sales.cancel` capability; if
  a concrete registry entry is missing in implementation, it must be added as
  the minimum new permission rather than inventing a different concept.
- Every Sale read/write is organization scoped and branch authorized. Caller-
  supplied organization, branch, actor, permission, or device authority fields
  are never trusted.
- Sale records POS device only when a real authenticated device identity exists.
  Until then, `deviceId` remains nullable and the authenticated
  salesperson/operator identity is always recorded.

### 7. Idempotency and anti-double-checkout

- `POST /sales` requires `Idempotency-Key`.
- Checkout is a local acceptance command whose durable outcome, Sale creation,
  SaleItems, Cart terminal transition, and local Outbox/event records must be
  committed atomically in the Sales/Cart transaction where technically owned
  together.
- Matching `Idempotency-Key` + same semantic request replays the same logical
  Sale result.
- Matching `Idempotency-Key` + different semantic request returns
  `IDEMPOTENCY_CONFLICT`.
- Independent of HTTP retry behavior, the same Cart/version must not produce two
  active Sales. This invariant must be enforced at the persistence level where
  practical, not only by an application pre-check.

### 8. Inventory reservation semantics in `PENDING_PAYMENT`

- `PENDING_PAYMENT` does reserve/allocate the required Inventory through
  Inventory module contracts.
- When checkout succeeds from a held Cart, Inventory rebinds the existing active
  reservation from the Cart-hold reference to the new Sale reference. The old
  Cart-hold TTL no longer applies after rebind; the reservation remains active
  while the Sale is `PENDING_PAYMENT` until completion or cancellation.
- `PENDING_PAYMENT` does not:
  - consume final stock
  - consume FIFO layers
  - write the final Inventory sale-consumption ledger effect
  - perform cash/wallet/credit accounting
  - fake payment success
- The reservation protects stock while payment is pending and remains traceable
  from the Sale.
- Sales never mutates Inventory tables directly.

### 9. Cancellation

- `PENDING_PAYMENT → CANCELLED` is allowed.
- Cancellation is idempotent and releases the Sale's active reservation or
  allocation exactly once through Inventory contracts.
- Cancellation never consumes Inventory, FIFO, or final sale ledger effects.
- Cancellation does not delete the Sale and preserves immutable historical Sale
  snapshot facts.
- Cancellation records audit metadata and cancellation reason using the current
  repository conventions.
- `COMPLETED → CANCELLED` is not the normal path. Future completed-sale reversal
  belongs to Returns/Refunds, not simple Sale cancellation.

### 10. Trusted payment-completion boundary

- M5 implements the trusted application/module contract:

  ```text
  CompleteSaleAfterPayment
  ```

  for future Payments integration.
- It accepts a trusted payment-completion context/reference and transitions:

  ```text
  PENDING_PAYMENT → COMPLETED
  ```

- Completion must be idempotent and must, exactly once:
  - consume the reserved Inventory
  - consume FIFO layers
  - create the final Inventory sale ledger effect
  - release or convert reservation state correctly
  - emit completion integration effects/outbox records
- The future Payments context will call the Sales completion contract; it will
  not mutate Sales or Inventory persistence directly.
- If `POST /sales/{saleId}/complete` is retained because the authoritative API
  architecture already lists it, it is an internal/test/staging-only boundary
  protected by the trusted internal authorization pattern. It is not a normal
  public cashier endpoint and does not accept a caller-controlled
  `paymentSucceeded` assertion.

### 11. Customer references

- Customer is optional. Walk-in Sale uses `customerId = null`.
- If a `customerId` is supplied, Sales validates organization ownership through
  Customers contracts and may snapshot only the minimum historical facts needed
  by the Sales architecture.
- Cross-tenant customer references are forbidden.
- Sales never mutates Customers persistence directly.

### 12. Cross-context ownership

- Sales owns Sale lifecycle, Cart-to-Sale conversion, immutable Sale snapshot
  facts, cancellation semantics, and the trusted completion boundary.
- Pricing owns price resolution and price rules.
- Inventory owns reservation/allocation creation, release, final stock
  consumption, FIFO, and Inventory ledger history.
- Customers owns customer identity/persistence.
- Payments will own provider/payment success determination and financial
  accounting flows.
- M5 implementation must use module contracts and outbox/inbox patterns where
  needed; it must not directly mutate Pricing, Inventory, or Customers tables.

## Checkout execution order

For a `DRAFT` Cart checkout the intended execution order is:

```text
validate Cart/version
→ validate warehouse
→ obtain fresh authoritative Pricing quote
→ atomically establish Inventory reservation
→ create immutable Sale/SaleItems snapshot
→ bind reservation to Sale
→ mark Cart CHECKED_OUT
→ persist idempotency outcome/outbox
```

If a held reservation expires or is released before rebind, checkout must not
silently treat it as valid. It may fall back to the `DRAFT`-style reservation
path only when a valid authoritative warehouse is known; otherwise checkout
fails with an explicit reservation or availability conflict.

## Alternatives

- **Trust the Cart's previously returned quote at checkout:** rejected because
  quote is informational and stale client totals would corrupt historical Sale
  pricing.
- **Require an existing hold for every checkout:** rejected because a normal
  `DRAFT` Cart is allowed to checkout directly after fresh authoritative
  reservation.
- **Release a held reservation at the moment of checkout and re-reserve under
  Sale:** rejected because it creates avoidable oversell windows and duplicate-
  reservation risk.
- **Leave the source Cart editable after Sale creation:** rejected because the
  same draft could be mutated or checked out again, breaking historical
  traceability and anti-double-sale guarantees.
- **Consume Inventory/FIFO at `PENDING_PAYMENT`:** rejected per ADR-0009 because
  unsuccessful payment must not create final stock or ledger effects.
- **Expose completion as a normal public cashier endpoint with a payment success
  flag:** rejected because payment success must come from a trusted Payments/
  internal boundary.
- **Create Sales by mutating Inventory/Customers/Pricing tables directly:**
  rejected by bounded-context ownership rules.

## Consequences

- M5-007 requires additive Sales persistence plus an additive Cart status
  expansion from `DRAFT`-only to include terminal `CHECKED_OUT`.
- Checkout and cancellation require real PostgreSQL coverage for tenant scope,
  optimistic concurrency, uniqueness, idempotency replay/conflict, and
  duplicate-checkout races.
- The trusted completion boundary is implemented now so M5 can prove exact-once
  Inventory/FIFO consumption without introducing fake provider or cash logic.
- POS device identity remains an explicit extension point: schema and contracts
  accept a nullable device reference until the real device-auth/runtime exists.

## Security

- Tenant and branch scope are always derived from the authenticated principal and
  validated server-side.
- Cross-tenant Cart, Customer, branch, and warehouse injection attempts must be
  denied or masked according to existing API conventions.
- Public responses expose the immutable Sale snapshot and relevant shortages/
  state, not internal FIFO cost internals or unauthorized customer data.
- Completion trusts only the internal/trusted boundary pattern; a valid tenant
  bearer JWT alone is insufficient to assert payment success.

## Compatibility

- The change is additive at the schema, contract, and API level.
- Existing POS Cart save/hold/resume/quote/availability behavior remains intact.
- Existing held reservations remain authoritative and may be reused at checkout
  when still valid and compatible.
- Payments, cash accounting, wallet/credit, invoice issuance, and offline sale
  synchronization remain separate follow-on bounded-context work.
