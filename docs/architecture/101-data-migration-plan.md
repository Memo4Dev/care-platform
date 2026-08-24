# Data Migration Plan

## Migration categories

### Reference/master data
- organizations
- branches
- users
- products
- customers
- suppliers

### Transactional data
- sales
- purchases
- returns
- payments

### Derived/current state
- stock quantity
- wallet balance
- customer debt
- cash balance

Derived/current state must be reconciled against transaction history where possible.

## Inventory migration

Preferred:

```text
historical transactions available
→ reconstruct ledger
→ reconstruct FIFO layers
→ compute current StockPosition
```

If history is incomplete:

```text
OpeningStock migration entry
```

with:
- migration timestamp
- source system reference
- imported quantity
- imported cost basis
- explicit MIGRATION reason

Do not fake old purchase history.

## Customer debt

Create migration ledger entry:

```text
MIGRATION_OPENING_DEBT
```

then verify current debt matches legacy.

## Wallet

Use:

```text
MIGRATION_OPENING_WALLET_BALANCE
```

## Cash

Prefer migration at controlled cutover:

```text
close legacy cash session
count physical cash
open new cash session with verified opening balance
```

## Verification report

Every migration batch outputs:

```text
records read
records imported
records rejected
sum/quantity before
sum/quantity after
difference
```

No silent skips.
