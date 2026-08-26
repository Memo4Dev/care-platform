# @commerce-platform/database

Shared PostgreSQL persistence foundation for all M1+ bounded contexts: Drizzle
ORM client factory, schema column conventions, and the generated SQL migration
set.

## Usage

```ts
import { createDatabaseClient, readDatabaseConfigFromEnv } from '@commerce-platform/database';

const db = createDatabaseClient(readDatabaseConfigFromEnv());
```

### Environment

| Variable            | Required | Default | Meaning                            |
| ------------------- | -------- | ------- | ---------------------------------- |
| `DATABASE_URL`      | yes      | —       | PostgreSQL connection string       |
| `DATABASE_SSL`      | no       | `false` | Enable TLS (`1`/`true`/`yes`/`on`) |
| `DATABASE_POOL_MAX` | no       | `10`    | Maximum pool size                  |

SSL is off by default so native local Postgres works without TLS; enable it for
managed/remote deployments.

## Schema conventions

Sourced from `docs/architecture/30-persistence-overview.md`.

### Logical schemas

Every bounded context owns one or more PostgreSQL logical schemas. Business
tables are added to `src/schema/` in later tasks (organization, identity,
catalog, pricing, customers, inventory, purchasing, cart, orders, sales,
fulfillment, payments, cash, returns, delivery, storefront, offline, audit,
integration). This package currently ships **only** shared helpers.

### Global rules

- **UUIDv7 technical IDs.** Generated application-side via `newId()` so IDs
  exist before insert and sort by creation time. DB-side `gen_random_uuid()`
  (`idColumnDbGenerated()`, UUIDv4) is a fallback only — Postgres 16 has no
  native `uuidv7()`.
- **Human-readable numbers** are separate business identifiers, never the
  technical primary key.
- **Tenant scoping.** Every tenant-owned table contains `organization_id`.
  Prefer `UNIQUE (organization_id, business_key)` composite uniqueness.
- **Optimistic concurrency** via the `version integer NOT NULL DEFAULT 1`
  helper on mutable aggregates.
- **No generic soft-delete** of immutable financial/operational history.
- **Money and quantities use `numeric`**, never float.
- **Timestamps are `timestamptz`** (`timestamps` helper: `created_at`,
  `updated_at`).
- Local transaction boundaries normally stay inside one context; cross-context
  reliability uses Outbox/Inbox (see architecture docs before adding any).

## Migrations

- Schema sources: `src/schema/**` (Drizzle Kit picks up every export there).
- Generated SQL: `drizzle/` — committed to git together with the schema change.

Workflow after changing schema files:

```sh
pnpm --filter @commerce-platform/database generate   # review the SQL it emits
pnpm --filter @commerce-platform/database migrate    # apply locally
```

`runMigrations(db)` from this package applies pending migrations
programmatically (used by `@commerce-platform/testing` against fresh test
databases). The Database Gate in `docs/architecture/92-quality-gates.md`
applies: never casually drop populated columns, rewrite huge tables, or mutate
immutable ledger history.

## Testing

Unit tests live beside sources as `*.spec.ts`. Integration tests belong to
`@commerce-platform/testing` and run with `pnpm test:integration`.
