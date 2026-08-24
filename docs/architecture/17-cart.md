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
- Draft expiration/reservation behavior is Organization Policy.
- POS carts preserve branch/device scope.
