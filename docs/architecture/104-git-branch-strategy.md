# Git / Branch Strategy

Recommended:

```text
main
feature/<context>-<goal>
fix/<context>-<issue>
refactor/<context>-<goal>
migration/<context>-<goal>
```

Examples:

```text
feature/inventory-reservations
refactor/catalog-module-boundary
migration/inventory-ledger-v1
fix/offline-idempotency
```

## Commit style

Keep commits reviewable and domain-focused.

Examples:

```text
feat(inventory): add reservation aggregate
test(inventory): cover concurrent reservation conflict
refactor(sales): route pricing through module contract
migrate(inventory): backfill opening stock ledger
docs(api): define POS sync conflict contract
```

## PR rule

One PR should have one clear architectural goal.

Avoid:

```text
inventory + UI redesign + auth refactor + deployment change
```

in one PR.

## Merge rule

Prefer squash or clean merge strategy according to team preference, but commit/PR history must preserve understandable change intent.
