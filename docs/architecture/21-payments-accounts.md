# Payments & Customer Accounts Context

## Owns

- Payment
- Refund
- Wallet + Wallet Ledger
- CreditAccount + Credit Ledger
- LoyaltyAccount + Points Ledger

## Rules

- No split payment in v1.
- Online customer cannot use Credit.
- Credit override requires permission + reason.
- Wallet/Credit ledgers are immutable.
- Payment callbacks are idempotent.

## M5 boundary

M5 does not implement payment attempts, providers, or financial ledgers. Future
Payments publishes/requests an idempotent payment-completion contract carrying a
stable payment-completion reference, correlation ID, and causation ID. Sales
uses that contract to transition a `PENDING_PAYMENT` Sale to `COMPLETED` exactly
once. A public POS caller cannot assert payment success directly.

## Refund policy

Online customer:
Refund <= organization threshold → Wallet
Refund > threshold → Original payment method
Authorized override is possible.

Business/POS customer:
Return value reduces outstanding debt first.
Remaining value goes to Wallet.
