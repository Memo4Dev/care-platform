# Cash Management / Treasury Context

## Owns
- CashRegister
- CashSession
- CashLedger
- CashTransfer
- CashReconciliation

## Responsibility
Physical cash custody and reconciliation.

## Distinction
Payments = how/why money was paid.
Cash Management = where physical cash is held.

## Rules
- Opening balance is explicit.
- Cash Ledger is append-only.
- Closing requires cash count.
- Expected vs Actual difference is explicit and audited.
- Cash payment/refund events create Cash movements idempotently.
