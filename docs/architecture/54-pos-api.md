# POS API

Base path:

```text
/api/v1/pos
```

POS API is optimized for low latency, branch scoping, device identity, and offline recovery.
Device identity and offline recovery remain target architecture; they are not
implicitly provided by the M5 Cart bearer transition below.

## POS Operator Authentication

The target POS quick operator authentication uses Employee Card/Barcode + PIN.

- Barcode/card alone is never sufficient.
- Employee barcode/card identifiers are opaque; they do not encode
  email, role, organizationId, or permissions.
- Authentication proves identity; authorization (server-side RBAC,
  branch scope, POS permissions) is resolved separately after
  successful Card + PIN verification.

```text
POST /auth/operator
```

Input:

```text
deviceId
barcode (opaque employee credential)
pin
```

Output:

```text
operatorId
branchId
roles
permissions
token (short-lived session token)
```

Manager approval may use Manager Card + PIN without replacing or
logging out the active cashier. Both actors are recorded:

```text
performedBy = active cashier
approvedBy  = manager
```

This endpoint and the device/Card/PIN session are not implemented by M5-004.

### M5-004 transitional online credential

The canonical online Cart routes temporarily use the tenant bearer JWT through
`PosOperatorGuard`. It accepts only a trusted, server-resolved
`ORGANIZATION_USER`, then evaluates `sales.create`, Organization scope, and branch
access through application authorization. It does not establish POS Device,
Card/PIN operator, Cash Session, or offline identity. Request bodies must not
assert organization, user/operator, role/permission, or device authority.

## Device bootstrap

```text
POST /devices/register
GET  /bootstrap
GET  /changes
```

Bootstrap response should include only data allowed for the device:

```text
device
branch
warehouses
products
variants
barcodes
units
prices
customers subset
policies
allocations
sync checkpoint
```

## Catalog / Search

```text
GET /products/search?q=
GET /products/barcode/{barcode}   (POS)
GET /variants/{variantId}
```

Prefer a compact response suitable for local caching.

The POS variant `GET /products/barcode/{barcode}` resolves to
`/api/v1/pos/products/barcode/{barcode}?branchId=...`; it enforces
`PosOperatorGuard`, `sales.create`, and branch access, resolving through the
Catalog module contract and returning the sellable variant plus product context.

## M5-004/M5-005/M5-006 online Draft Carts

```text
POST   /carts
GET    /carts
GET    /carts/{cartId}
POST   /carts/{cartId}/items
PATCH  /carts/{cartId}/items/{itemId}
DELETE /carts/{cartId}/items/{itemId}
POST   /carts/{cartId}/save
POST   /carts/{cartId}/hold
POST   /carts/{cartId}/resume
POST   /carts/{cartId}/quote              (M5-006)
POST   /carts/{cartId}/check-availability (M5-006)
```

The public Cart resource uses `items`; no line-oriented alias or tenant-admin
Cart route is exposed.

### Save contract

`POST /carts/{cartId}/save` has no request body. It requires
`Idempotency-Key` and `If-Match` and uses `LOCAL_ATOMIC` durability scoped to the
canonical route, authenticated actor, and Organization.

The transaction locks the tenant-scoped `POS` `DRAFT` Cart root before checking
the expected version and loading the response snapshot. A matching replay
returns that same stored Cart. A changed expected version under the same key
returns `IDEMPOTENCY_CONFLICT`; a stale version under a distinct key returns
`RESOURCE_VERSION_CONFLICT`.

Save is a no-op on Cart business state: status, version, `updatedAt`, and items
remain unchanged. Empty Drafts are valid. Save emits no domain or Outbox event,
calls no Pricing, Inventory, or Sales contract, and creates no reservation,
allocation, Sale, or price snapshot. Per Pricing architecture, only completed
Orders/Sales store a price snapshot; later quote/reopen recalculates through
Pricing in M5-006.

### Hold/resume contract

`POST /carts/{cartId}/hold` has body `{ warehouseId }`. `POST
/carts/{cartId}/resume` is bodyless. Both require `Idempotency-Key`, `If-Match`,
the transitional tenant bearer accepted by `PosOperatorGuard`, `sales.create`,
Organization scope, and branch access.

Hold validates that the selected warehouse is active and belongs to the Cart's
Organization and branch. M5 does not auto-select a default warehouse and does not
split one Cart across warehouses. Empty Cart hold is invalid.

Hold converts Cart item quantities to exact variant base-unit demands and calls
Inventory through its module contract to create one atomic logical reservation.
If any demand is short, the response contains explicit shortages and no Inventory
reservation is created; the Cart remains editable. While a hold is pending,
active, or releasing, item/customer mutations return `OPERATION_NOT_ALLOWED`.

Resume releases the active Inventory reservation exactly once, handles already
released/expired reservations convergently, never creates or extends a
reservation, and returns the Cart to editable Draft behavior. The command
response includes the final released/expired hold state; later Cart reads omit a
current hold.

### Quote and availability contract (M5-006)

Both are read-only helpers for a POS operator building a Cart; they require the
transitional tenant bearer, `sales.create`, Organization scope, and branch
access. Reads do not require `Idempotency-Key` outcomes.

`POST /carts/{cartId}/quote` has optional body `{ priceType }` (default `CASH`).
For each Cart line it calls the Pricing module contract
(`getPriceQuote(orgId, { variantId, unitId, priceType, channel: 'POS', branchId })`)
and returns live per-line `unitPrice` (Pricing 4-decimal amount), an 8-decimal
`lineTotal = unitPrice × quantity`, and an 8-decimal grand `total`. Nothing is
persisted and no version is advanced; pricing recalculates on every call (M5-006).

`POST /carts/{cartId}/check-availability` has body `{ warehouseId }`. It
validates the warehouse belongs to the Cart's Organization and branch, then for
each line calls Inventory `getAvailability` and returns per-line `available` and
`shortage` at exact 8-decimal precision. The requested `quantity` is converted
to the variant's base unit (the availability projection basis) and each line
includes its `unitId`, so an explicit non-base-unit Cart line compares
correctly and unambiguously against base-unit stock. No reservation or
allocation is created.

Cart arithmetic (line totals, availability, shortages) uses integer math at
8-decimal scale; no floating-point values are used for money/quantity.

## Sales

```text
POST /sales
GET  /sales/{saleId}
POST /sales/{saleId}/cancel
```

Cart is the editable draft. Creating a Sale establishes `PENDING_PAYMENT` facts;
it does not consume final Inventory. Checkout from a plain `DRAFT` Cart requires
an explicit `warehouseId`; checkout from a valid held Cart derives the
authoritative warehouse from the held reservation and rebinds that reservation
to the Sale so the old hold TTL no longer applies.

The trusted completion boundary is internal/test/staging only:

```text
POST /internal/sales/{saleId}/complete
```

It requires `Idempotency-Key`, is protected by the repository's internal
service boundary, and is not a public assertion that a payment succeeded.

## Payments

```text
POST /payments
GET  /payments/{paymentId}
```

For CASH payments the client must have an open/eligible cash session according to policy.

## Cash Session

Cash Session is exclusively bound to: one POS Device, one Cash Drawer,
one Employee, one active shift/session. Multiple employees must not hold
simultaneous active Cash Sessions on the same drawer. Shift handoff
requires closing the existing session before another operator opens a new
one on that drawer.

```text
GET  /cash/session
POST /cash/session/open
POST /cash/session/count
POST /cash/session/close
```

`POST /cash/session/close` performs cash count and reconciliation by
default. Organization policy may disable mandatory reconciliation via
`cashSession.requireReconciliationOnClose = false`, but session close
remains fully audited in all cases.

## Customers

```text
GET  /customers/search
POST /customers
GET  /customers/{customerId}
GET  /customers/{customerId}/account-summary
```

## Returns

```text
POST /returns
GET  /returns/{returnId}
POST /returns/{returnId}/inspection
POST /returns/{returnId}/complete
```

## Offline pending sale behavior

If local allocation is exceeded:

```text
client status = OFFLINE_PENDING_VERIFICATION
```

The local client stores the sale and operation in its own database.

Once online, the Sync API submits the operation. The normal online `/sales` endpoint should not be abused as an offline replay endpoint.
