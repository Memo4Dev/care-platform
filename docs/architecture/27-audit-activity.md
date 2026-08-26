# Audit & Activity Context

## Owns
- AuditEntry
- ActivityEvent
- Security event history

## Distinction
Ledger = what happened to inventory/money.
Audit = who did what, where, when, why.
Activity = operational timeline.

## Rules
- Audit is append-only.
- Sensitive actions always audited.
- Overrides include reason and governing rule/policy.
- CorrelationId links cross-context workflows.
- Actor may be User/System/Customer/Device/ExternalProvider.

## POS Cash Session Audit

Cash Session close is always audited regardless of whether mandatory
reconciliation is enabled by organization policy. Audit entries for
cash session operations include:

```text
actor (authenticated operator)
deviceId
drawerId
sessionId
cashCount?
reconciliationResult?
performedBy
approvedBy? (for manager-approved actions)
correlationId
```

Manager-approved POS actions record both the active cashier
(`performedBy`) and the approving manager (`approvedBy`).
