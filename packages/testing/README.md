# @commerce-platform/testing

Integration-test harness shared by all M1+ tasks: provisions a real PostgreSQL
database per test file, applies the current Drizzle migrations, and guarantees
full cleanup.

## Usage

```ts
import { createTestDatabase } from '@commerce-platform/testing';

const testDb = await createTestDatabase();
// testDb.db      → Drizzle handle bound to the ephemeral database
// testDb.client  → underlying pg Pool (raw SQL when needed)
// testDb.uri     → connection string of the ephemeral database
await testDb.teardown(); // closes the pool, drops the database
```

## How a server is resolved (priority order)

1. **`TEST_DATABASE_URL` is set** → used as an _admin-capable base URL_ on a
   native Postgres server. The harness creates a uniquely named temporary
   database (`care_platform_test_<random>`) there and drops it on teardown —
   it never touches the database named in the URL itself.
2. **Docker is reachable** → Testcontainers starts a disposable
   `postgres:17-alpine` and the same temp-db lifecycle runs inside it.
3. **Neither** → creation fails with instructions describing option 1.

The connecting role needs `CREATE DATABASE` privilege (it creates and drops
databases). `DROP DATABASE ... WITH (FORCE)` requires PostgreSQL ≥ 13, which is
the minimum this repo targets for tests.

### Local examples

Native Homebrew Postgres 16 at `localhost:5433` (trust auth):

```sh
TEST_DATABASE_URL="postgresql://localhost:5433/postgres" pnpm test:integration
```

Connect to the superuser's maintenance database (`postgres`) so `CREATE
DATABASE` succeeds; the actual test data lives in throwaway databases only.

### CI

The GitHub Actions workflow provides a `postgres:17-alpine` service container
and exports `TEST_DATABASE_URL` automatically; no local Docker required.

## Factories

`src/factories.ts` documents the conventions later domain factories follow:
valid state by default, explicit IDs for determinism, tenant-scoped shapes,
no shared mutable fixtures (see `docs/architecture/91-testing-architecture.md`).
