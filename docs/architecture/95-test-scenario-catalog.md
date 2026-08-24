# Critical Test Scenario Catalog

Use stable scenario IDs so agents, CI and documentation can reference the same cases.

## Inventory

```text
INV-001 concurrent reservations cannot oversell
INV-002 FIFO consumes oldest available layer
INV-003 reservation expiration releases availability
INV-004 transfer does not credit destination before receipt
INV-005 adjustment requires configured approval
```

## POS / Offline

```text
OFF-001 offline sale within allocation syncs successfully
OFF-002 duplicate operation does not duplicate sale
OFF-003 allocation overflow becomes pending verification
OFF-004 same-branch warehouse recovery runs first
OFF-005 unresolved shortage creates manager resolution
OFF-006 revoked device cannot sync
OFF-007 sequence replay is rejected/idempotently recognized
```

## Orders

```text
ORD-001 online checkout reserves stock
ORD-002 expired reservation blocks approval
ORD-003 cancellation releases reservation
ORD-004 picking shortage searches same branch warehouse
ORD-005 cross-branch alternative is proposed to Sales
```

## Payments / Accounts

```text
PAY-001 duplicate provider callback is idempotent
PAY-002 online customer cannot use credit
PAY-003 refund <= configured threshold goes to online wallet
PAY-004 refund > threshold uses original payment method
PAY-005 business return reduces debt before wallet credit
```

## Cash

```text
CSH-001 cash sale creates one cash movement
CSH-002 duplicate event creates no duplicate movement
CSH-003 closed session rejects ordinary movement
CSH-004 reconciliation records difference
```

## Multi-Tenant

```text
TEN-001 Tenant B cannot read Tenant A sale
TEN-002 Tenant B cannot inject Tenant A branch
TEN-003 tenant foreign-key injection fails
TEN-004 platform support requires active support session
```

## Subscription

```text
SUB-001 inactive entitlement blocks feature
SUB-002 plan resource limit blocks excess creation
SUB-003 temporary override expires
SUB-004 provisioning retry creates no duplicate defaults
```
