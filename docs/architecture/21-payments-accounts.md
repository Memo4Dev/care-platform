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

## Refund policy
Online customer:
Refund <= organization threshold → Wallet
Refund > threshold → Original payment method
Authorized override is possible.

Business/POS customer:
Return value reduces outstanding debt first.
Remaining value goes to Wallet.
