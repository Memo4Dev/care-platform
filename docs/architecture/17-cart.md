# Cart Context

## Owns

- Cart
- CartItem

## Channels

- ONLINE
- POS
- SALES

## Rules

- Cart != Order != Sale.
- Online add-to-cart does not reserve stock.
- Reservation happens during checkout.
- Draft carts can be saved and reopened.
- POS carts preserve branch/device scope.

## M5-004/M5-005 canonical POS Cart surface

M5 exposes only the online, versioned POS Draft Cart routes below:

```text
POST   /api/v1/pos/carts
GET    /api/v1/pos/carts
GET    /api/v1/pos/carts/{cartId}
POST   /api/v1/pos/carts/{cartId}/items
PATCH  /api/v1/pos/carts/{cartId}/items/{itemId}
DELETE /api/v1/pos/carts/{cartId}/items/{itemId}
POST   /api/v1/pos/carts/{cartId}/save
POST   /api/v1/pos/carts/{cartId}/hold
POST   /api/v1/pos/carts/{cartId}/resume
```

The public DTO uses `items` and `CartItem`; persistence and domain internals may
retain line-oriented naming. There is no tenant-admin Cart facade or public
line-oriented route alias.

### Transitional M5 authentication

Until POS Device and Employee Card/Barcode + PIN authentication are implemented,
the online M5 Cart surface accepts the existing tenant bearer JWT through
`PosOperatorGuard`. The guard must produce a trusted, server-resolved
`ORGANIZATION_USER`; authorization still requires `sales.create`, the same
Organization, and branch access. This transition does not prove a device,
operator Card/PIN, Cash Session, or offline identity, and callers cannot provide
organization, user/operator, role/permission, or device authority fields.

### Save semantics

`POST /api/v1/pos/carts/{cartId}/save` has no request body and requires both
`Idempotency-Key` and `If-Match`.

- Idempotency is `LOCAL_ATOMIC`, scoped by the canonical route, authenticated
  organization user, and Organization. The request fingerprint includes the
  Cart ID and expected version.
- The transaction locks the tenant-scoped `POS` `DRAFT` Cart root before checking
  `If-Match` and reading the returned Cart snapshot.
- A matching replay returns the same durable Cart snapshot. Reusing the key with
  a changed expected version returns `IDEMPOTENCY_CONFLICT`; a stale version under
  a distinct key returns `RESOURCE_VERSION_CONFLICT`.
- Save is a durable acknowledgement only. It does not change status, version,
  `updatedAt`, or items; it emits no domain/integration event and calls no
  Pricing, Inventory, or Sales contract.
- Empty Draft Carts may be saved. Save creates no reservation, allocation, Sale,
  or price snapshot.
- Price snapshots exist only on completed Orders/Sales. A later quote or reopen
  recalculates through Pricing as part of M5-006; save never freezes a price.

## POS hold policy

- A normal POS Draft Cart performs availability checks only; it never reserves
  stock.
- `Hold Cart` requests an Inventory reservation. The default TTL is 15 minutes
  and `CART.holdReservationTtlMinutes` is an Organization Policy constrained to
  whole minutes from 1 through 1440.
- `POST /api/v1/pos/carts/{cartId}/hold` requires `Idempotency-Key`, `If-Match`,
  and one explicit `warehouseId`; the warehouse must be active and belong to the
  Cart's Organization and branch. M5 does not auto-select or split warehouses.
- Hold creates one Cart-owned workflow checkpoint and one Inventory-owned logical
  multi-position reservation for the exact Cart version. The Inventory command is
  all-or-nothing: every demanded base-unit quantity reserves atomically, or the
  response returns explicit shortages and no Inventory reservation side effect.
- Cart item/customer mutations are rejected while a hold is pending, active, or
  releasing. A failed-shortage hold is not current and the Cart remains editable.
- Holding an empty Cart is rejected.
- `POST /api/v1/pos/carts/{cartId}/resume` is bodyless, requires
  `Idempotency-Key` and `If-Match`, releases the active Inventory reservation at
  most once, never creates or extends a reservation, and makes the Cart editable
  again. The response includes the released/expired hold state and current
  shortages/availability details when Inventory reports them; subsequent Cart
  reads show no current hold.
- Reservation expiration releases Inventory through the Inventory context's
  due-reservation worker and lazy release/check path. The persisted Cart remains
  but its held reservation is no longer valid.
- Hold, resume, expiration, and reservation release are idempotent and
  concurrency safe. Cart never mutates Inventory persistence directly.

## M5-006: Pricing quote and availability integration

The Cart module imports `PricingModule` and depends on its `PRICING_CONTRACTS`
(`getPriceQuote`) and on `InventoryContracts.getAvailability`. These are the only
cross-context reads Cart makes; Cart never reads Pricing or Inventory tables
directly.

- `POST /api/v1/pos/carts/{cartId}/quote` with optional body `{ priceType }`
  (default `CASH`) resolves a live price for every line against the Organization's
  default price book through `getPriceQuote(orgId, { variantId, unitId, priceType,
  channel: 'POS', branchId })`. It returns per-line `unitPrice` (Pricing 4-decimal
  amount), 8-decimal `lineTotal`, and an 8-decimal grand `total`. It is a read: it
  persists nothing and never advances the Cart version.
- `POST /api/v1/pos/carts/{cartId}/check-availability` with body `{ warehouseId }`
  validates the warehouse belongs to the Cart's Organization and branch, then per
  line calls `getAvailability` and returns exact 8-decimal `available` and
  `shortage`. It creates no reservation or allocation. Each line's requested
  `quantity` is converted to the variant's base unit (the stock position basis)
  so non-base-unit lines compare correctly; the response includes the line's
  `unitId` to make the basis explicit.
- Barcode scan (`GET /api/v1/pos/products/barcode/{barcode}?branchId=...`) resolves
  a variant through the Catalog `resolveBarcode` /
  `validateSellableVariant` contracts, enforcing `sales.create` and branch access.
  The response's `sellable` flag is `true` only when the variant and its product
  are both `ACTIVE`; a scan may still return a non-ACTIVE variant for display with
  `sellable: false`. It is a POS helper; the Cart add-item flow enforces
  `VARIANT_NOT_SELLABLE` for non-ACTIVE items.
- Money/quantity arithmetic in quote and availability uses integer math at
  8-decimal scale; no floating-point values are used. The Pricing module returns
  prices at its own 4-decimal `amount` precision; Cart converts to 8-decimal
  totals.
- Quoted prices are never frozen on the Cart; a later Sale completion stores the
  price snapshot in the Sales/Pricing context. Quote recalculates live each call.
