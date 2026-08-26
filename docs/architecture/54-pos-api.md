# POS API

Base path:

```text
/api/v1/pos
```

POS API is optimized for low latency, branch scoping, device identity, and offline recovery.

## POS Operator Authentication

POS quick operator authentication uses Employee Card/Barcode + PIN.

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
GET /products/barcode/{barcode}
GET /variants/{variantId}
```

Prefer a compact response suitable for local caching.

## Draft Carts

```text
POST   /carts
GET    /carts
GET    /carts/{cartId}
POST   /carts/{cartId}/items
PATCH  /carts/{cartId}/items/{itemId}
DELETE /carts/{cartId}/items/{itemId}
POST   /carts/{cartId}/save
POST   /carts/{cartId}/reopen
POST   /carts/{cartId}/cancel
```

## Pricing quote

```text
POST /pricing/quote
```

Input:

```text
branchId
customerId?
items[]
paymentType?
priceType?
couponCode?
```

Output:

```text
line prices
discounts
taxes
total
applied price types
override requirements if any
```

## Sales

```text
POST /sales
GET  /sales/{saleId}
POST /sales/{saleId}/confirm
POST /sales/{saleId}/complete
POST /sales/{saleId}/cancel
```

`POST /sales/{saleId}/complete` requires `Idempotency-Key`.

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
