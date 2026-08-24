# POS API

Base path:

```text
/api/v1/pos
```

POS API is optimized for low latency, branch scoping, device identity, and offline recovery.

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

```text
GET  /cash/session
POST /cash/session/open
POST /cash/session/count
POST /cash/session/close
```

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
