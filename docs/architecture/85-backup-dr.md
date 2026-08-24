# Backup & Disaster Recovery

## Backup goals

Protect:

- PostgreSQL
- object storage
- critical configuration
- deployment metadata
- encryption/secrets backup procedures

## PostgreSQL

Use:

- automated full backups
- WAL/point-in-time recovery
- encrypted storage
- off-site/independent retention
- regular restore tests

## RPO / RTO

Define commercially before production.

Examples of decisions to make later:

```text
RPO: acceptable data loss window
RTO: acceptable recovery time
```

No arbitrary SLA values are assumed here.

## Restore drills

A backup is not trusted until restored.

Perform scheduled drills:

```text
restore DB
validate schema
validate ledgers
validate key workflows
validate object references
```

## Disaster scenarios

Plan for:

- database corruption
- region outage
- accidental destructive migration
- secret compromise
- object-storage deletion
- provider outage

## Ledger verification

After restore verify:

- inventory projection can reconcile with ledger
- wallet balance matches wallet ledger
- credit debt matches credit ledger
- cash expected balance matches cash ledger
- audit chain/checks are valid where implemented
