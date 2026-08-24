# Financial Persistence

## Payments
payments.payments
payments.payment_refunds

## Wallet
payments.wallets
payments.wallet_ledger

## Credit
payments.credit_accounts
payments.credit_ledger

## Loyalty
payments.loyalty_accounts
payments.loyalty_ledger

## Cash
cash.cash_registers
cash.cash_sessions
cash.cash_ledger
cash.cash_transfers

Rules:
- ledger tables append-only
- idempotency keys are unique per organization
- wallet/current debt projection updates in same local transaction as ledger append
- provider callbacks are deduplicated
- closed CashSession cannot receive ordinary new movements
