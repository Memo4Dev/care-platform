# Storefront API

Base path:

```text
/api/v1/storefront
```

Tenant/store resolution may come from:

```text
custom domain
store slug
authenticated store context
```

Never trust an arbitrary organizationId from the public request body.

## Public Store

```text
GET /store
GET /categories
GET /products
GET /products/{slug}
GET /products/{productId}/availability
```

Product responses should use Storefront presentation data plus Catalog/Pricing/Inventory projections.

## Account

```text
POST /account/register
POST /account/verify
GET  /account/me
PATCH /account/me

GET  /account/addresses
POST /account/addresses
PATCH /account/addresses/{addressId}
DELETE /account/addresses/{addressId}
```

## Cart

```text
POST   /cart
GET    /cart/{cartId}
POST   /cart/{cartId}/items
PATCH  /cart/{cartId}/items/{itemId}
DELETE /cart/{cartId}/items/{itemId}
```

## Checkout

```text
POST /checkout/{cartId}/preview
POST /checkout/{cartId}/confirm
```

Preview orchestrates:

```text
current pricing
current stock availability
reservation possibility
fulfillment candidate
pickup suggestion
delivery quote
payment methods
```

Confirm requires idempotency.

## Orders

```text
GET  /orders
GET  /orders/{orderId}
POST /orders/{orderId}/cancel
```

The customer may cancel only while policy/order state allows.

## Wallet

```text
GET /wallet
GET /wallet/transactions
```

Online customer wallet is separate from business/POS credit account.

## Returns

```text
POST /returns
GET  /returns
GET  /returns/{returnId}
```

Refund destination follows organization policy:

```text
amount <= threshold → Wallet
amount > threshold → Original Payment Method
```
