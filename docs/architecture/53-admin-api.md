# Admin API

This API is for owners, managers, inventory staff, purchasing staff, finance staff, and privileged operational users.

## Conventions

- Base path: `/api/v1/admin`
- Tenant derived from authenticated user context.
- Branch scope enforced by authorization.
- Mutations support optimistic concurrency where applicable.
- Sensitive actions require explicit permissions and audit.

## Organization

```text
GET    /organizations/me
PATCH  /organizations/me
GET    /branches
POST   /branches
GET    /branches/{branchId}
PATCH  /branches/{branchId}

GET    /branches/{branchId}/warehouses
POST   /branches/{branchId}/warehouses
PATCH  /warehouses/{warehouseId}

GET    /policies
GET    /policies/{policyType}
PUT    /policies/{policyType}
```

## Users / Roles

```text
GET    /users
POST   /users
GET    /users/{userId}
PATCH  /users/{userId}

GET    /roles
POST   /roles
PATCH  /roles/{roleId}
PUT    /roles/{roleId}/permissions

PUT    /users/{userId}/branches/{branchId}/access
DELETE /users/{userId}/branches/{branchId}/access
```

## Catalog

```text
GET    /products
POST   /products
GET    /products/{productId}
PATCH  /products/{productId}

POST   /products/{productId}/variants
PATCH  /variants/{variantId}

POST   /variants/{variantId}/barcodes
DELETE /variants/{variantId}/barcodes/{barcodeId}

GET    /units
POST   /units
POST   /variants/{variantId}/unit-conversions

GET    /categories
POST   /categories
PATCH  /categories/{categoryId}
```

## Pricing

```text
GET    /price-books
POST   /price-books
GET    /price-books/{priceBookId}
PUT    /price-books/{priceBookId}/entries

GET    /promotions
POST   /promotions
PATCH  /promotions/{promotionId}

GET    /coupons
POST   /coupons
PATCH  /coupons/{couponId}
```

## Inventory

```text
GET    /inventory/stock
GET    /inventory/availability
GET    /inventory/ledger
GET    /inventory/fifo-layers

GET    /inventory/reservations
GET    /inventory/allocations

GET    /inventory/transfers
POST   /inventory/transfers
POST   /inventory/transfers/{id}/submit
POST   /inventory/transfers/{id}/approve
POST   /inventory/transfers/{id}/dispatch
POST   /inventory/transfers/{id}/receive
POST   /inventory/transfers/{id}/cancel

GET    /inventory/adjustments
POST   /inventory/adjustments
POST   /inventory/adjustments/{id}/approve
POST   /inventory/adjustments/{id}/reject
```

## Purchasing

```text
GET    /suppliers
POST   /suppliers
PATCH  /suppliers/{supplierId}

GET    /purchase-orders
POST   /purchase-orders
GET    /purchase-orders/{id}
PATCH  /purchase-orders/{id}
POST   /purchase-orders/{id}/submit
POST   /purchase-orders/{id}/approve
POST   /purchase-orders/{id}/reject
POST   /purchase-orders/{id}/send
POST   /purchase-orders/{id}/cancel

GET    /goods-receipts
POST   /goods-receipts
POST   /goods-receipts/{id}/confirm
```

## Orders / Fulfillment

```text
GET    /orders
GET    /orders/{id}
POST   /orders/{id}/review
POST   /orders/{id}/approve
POST   /orders/{id}/reject
POST   /orders/{id}/cancel

GET    /fulfillments
GET    /fulfillments/{id}
POST   /fulfillments/{id}/approve
POST   /fulfillments/{id}/partial
```

## Returns

```text
GET    /returns
GET    /returns/{id}
POST   /returns/{id}/approve
POST   /returns/{id}/reject
POST   /returns/{id}/inspection
POST   /returns/{id}/complete
```

## Payments / Credit / Wallet

```text
GET    /payments
GET    /payments/{id}
POST   /payments/{id}/refunds

GET    /customers/{customerId}/wallet
GET    /customers/{customerId}/credit-account
PUT    /customers/{customerId}/credit-limit
POST   /customers/{customerId}/credit-account/payments
```

## Cash Management

```text
GET    /cash/registers
POST   /cash/registers

GET    /cash/sessions
POST   /cash/registers/{id}/sessions/open
POST   /cash/sessions/{id}/count
POST   /cash/sessions/{id}/reconcile
POST   /cash/sessions/{id}/close

GET    /cash/transfers
POST   /cash/transfers
POST   /cash/transfers/{id}/approve
POST   /cash/transfers/{id}/dispatch
POST   /cash/transfers/{id}/receive
```

## Delivery

```text
GET    /deliveries
GET    /deliveries/{id}
POST   /deliveries/{id}/assign-driver
POST   /deliveries/{id}/retry
POST   /deliveries/{id}/switch-provider
```

## Audit

```text
GET    /audit
GET    /activity
```

Audit query filters:

```text
actor
branch
resourceType
resourceId
action
from
to
correlationId
```
