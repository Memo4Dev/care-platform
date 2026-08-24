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
