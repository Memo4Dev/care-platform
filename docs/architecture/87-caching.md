# Caching Strategy

## Safe cache candidates

- public Storefront catalog presentation
- categories
- product metadata
- branch/store settings
- plan/entitlement lookups
- non-critical read projections

## Careful/short cache

- prices
- inventory availability
- authorization/permissions

These may change quickly and require invalidation/versioning.

## Never treat cache as authoritative

Do not use cache alone to approve:

- stock reservation
- stock consumption
- wallet debit
- credit usage
- refund
- cash movement

## Cache keys

Include tenant scope:

```text
org:{organizationId}:product:{productId}
org:{organizationId}:price:{branchId}:{variantId}
```

## Invalidation

Prefer domain-event-driven invalidation for:

```text
ProductUpdated
PriceChanged
StoreProductUpdated
PolicyChanged
EntitlementChanged
```
