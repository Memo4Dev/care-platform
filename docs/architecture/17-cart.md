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

## POS hold policy

- A normal POS Draft Cart performs availability checks only; it never reserves
  stock.
- `Hold Cart` requests an Inventory reservation. The default TTL is 15 minutes
  and `cart.holdReservationTtlMinutes` is an Organization Policy.
- Reservation expiration releases Inventory through the Inventory context's
  existing mechanism. The persisted Cart remains but its held reservation is no
  longer valid.
- Resuming an expired held Cart must recheck availability and surface shortages.
  It must not silently recreate a reservation when stock is unavailable.
- Hold, unhold/resume, and reservation release are idempotent and concurrency
  safe. Cart never mutates Inventory persistence directly.
