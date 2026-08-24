# API Use-Case Map

This is a use-case map, not a final OpenAPI file.

## Organization / Admin

```text
POST   /admin/branches
PATCH  /admin/branches/{branchId}
POST   /admin/warehouses
PATCH  /admin/policies/{policyType}
```

## Identity

```text
POST   /admin/users
POST   /admin/roles
PUT    /admin/roles/{roleId}/permissions
PUT    /admin/users/{userId}/branches/{branchId}/access
POST   /pos/devices/register
POST   /pos/devices/{deviceId}/revoke
```

## Catalog

```text
POST   /admin/products
POST   /admin/products/{productId}/variants
POST   /admin/variants/{variantId}/barcodes
POST   /admin/variants/{variantId}/units
GET    /catalog/products
GET    /catalog/variants/{variantId}
```

## Pricing

```text
POST   /admin/price-books
PUT    /admin/price-books/{priceBookId}/entries
POST   /admin/promotions
POST   /admin/coupons
POST   /pricing/quote
```

## Customers

```text
POST   /customers/business
GET    /customers/business
PATCH  /customers/business/{customerId}
POST   /storefront/account/register
GET    /storefront/account/me
```

## Inventory

```text
GET    /inventory/availability
GET    /inventory/stock
POST   /inventory/reservations
POST   /inventory/reservations/{id}/release
POST   /inventory/transfers
POST   /inventory/transfers/{id}/approve
POST   /inventory/transfers/{id}/dispatch
POST   /inventory/transfers/{id}/receive
POST   /inventory/adjustments
POST   /inventory/adjustments/{id}/approve
```

## Purchasing

```text
POST   /purchasing/suppliers
POST   /purchasing/purchase-orders
POST   /purchasing/purchase-orders/{id}/submit
POST   /purchasing/purchase-orders/{id}/approve
POST   /purchasing/goods-receipts
POST   /purchasing/goods-receipts/{id}/confirm
```

## Cart

```text
POST   /carts
POST   /carts/{id}/items
PATCH  /carts/{id}/items/{itemId}
DELETE /carts/{id}/items/{itemId}
POST   /carts/{id}/save
POST   /carts/{id}/checkout
```

## Orders

```text
POST   /orders
POST   /orders/{id}/submit
POST   /orders/{id}/review
POST   /orders/{id}/approve
POST   /orders/{id}/reject
PATCH  /orders/{id}
POST   /orders/{id}/cancel
GET    /orders/{id}
```

## Sales / POS

```text
POST   /pos/sales
POST   /pos/sales/{id}/confirm
POST   /pos/sales/{id}/complete
GET    /pos/sales/{id}
GET    /pos/drafts
```

## Fulfillment

```text
POST   /fulfillment/plans
POST   /fulfillments/{id}/approve
POST   /fulfillments/{id}/picking/start
POST   /fulfillments/{id}/picking/discrepancies
POST   /fulfillments/{id}/picking/complete
POST   /fulfillments/{id}/packing/complete
```

## Payments

```text
POST   /payments
GET    /payments/{id}
POST   /payments/{id}/refunds
GET    /customers/{id}/wallet
GET    /customers/{id}/credit-account
POST   /customers/{id}/credit-account/payments
```

## Cash

```text
POST   /cash/registers
POST   /cash/registers/{id}/sessions/open
POST   /cash/sessions/{id}/movements
POST   /cash/sessions/{id}/count
POST   /cash/sessions/{id}/reconcile
POST   /cash/sessions/{id}/close
```

## Returns

```text
POST   /returns
POST   /returns/{id}/approve
POST   /returns/{id}/reject
POST   /returns/{id}/inspection
POST   /returns/{id}/complete
```

## Delivery

```text
POST   /delivery/quotes
POST   /deliveries
POST   /deliveries/{id}/assign-driver
POST   /deliveries/{id}/attempts
POST   /deliveries/{id}/complete
GET    /deliveries/{id}/tracking
```

## Storefront

```text
GET    /storefront/products
GET    /storefront/products/{slug}
GET    /storefront/categories
POST   /storefront/cart
POST   /storefront/checkout
GET    /storefront/orders/{id}
```

## Offline Sync

```text
POST   /pos/sync
GET    /pos/sync/bootstrap
GET    /pos/sync/changes
POST   /pos/conflicts/{id}/resolve
```

## Provider callbacks

```text
POST   /webhooks/payments/{provider}
POST   /webhooks/delivery/{provider}
```
