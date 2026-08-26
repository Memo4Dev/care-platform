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

## Cash Session Binding

A Cash Session is exclusively bound to:

- one POS Device
- one Cash Drawer
- one Employee (authenticated operator)
- one active shift/session

Multiple employees must not hold simultaneous active Cash Sessions on
the same drawer. The concurrency constraint is enforced server-side.

## Shift Handoff

Shift handoff requires closing the existing Cash Session before another
operator may open a new session on that drawer. No concurrent open
sessions are permitted on a single Cash Drawer.

## Cash Count & Reconciliation

Cash count and reconciliation on Cash Session close is enabled by default.

Organization policy may disable mandatory reconciliation:

```text
cashSession.requireReconciliationOnClose = true (default)
```

Even when mandatory reconciliation is disabled, session close must
remain fully audited.

## Manager Approval

Manager approval at POS may use Manager Card + PIN without replacing or
logging out the active cashier. Both actors are recorded:

```text
performedBy = active cashier
approvedBy  = manager
```

## Offline Compatibility

Cash Session operations must remain compatible with offline POS
operation. Session open/close and movement recording must function
when the device is temporarily offline, with server reconciliation
on sync.
