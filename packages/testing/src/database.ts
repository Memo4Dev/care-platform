import { randomBytes } from 'node:crypto';

import {
  createDatabaseClient,
  runMigrations,
  type DatabaseClient,
} from '@commerce-platform/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, type Pool } from 'pg';

/**
 * Integration-test database handle.
 *
 * `db`/`client` point at a fresh ephemeral database; `uri` is its connection
 * string; `teardown()` closes the pool and destroys the database (and any
 * container this harness started).
 */
export interface TestDatabase {
  db: DatabaseClient;
  client: Pool;
  uri: string;
  teardown(): Promise<void>;
}

export interface CreateTestDatabaseOptions {
  /** Max pool size for the test handle. Default 5. */
  max?: number;
  /** Explicit migrations folder override; resolved module-relatively otherwise. */
  migrationsFolder?: string;
}

interface AdminTarget {
  /** Base URL whose server hosts the temporary databases (needs CREATE DATABASE). */
  adminUri: string;
  ownedContainer?: StartedPostgreSqlContainer;
}

const DEFAULT_TEST_DB_IMAGE = 'postgres:17-alpine';

/** Only lowercase alphanumerics and underscores; guards DDL interpolation. */
const DATABASE_NAME_PATTERN = /^[a-z0-9_]+$/;

/**
 * Guards caller-supplied database names before they are interpolated into
 * `CREATE DATABASE` / `DROP DATABASE` statements.
 */
function assertValidDatabaseName(databaseName: string): void {
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      `Invalid PostgreSQL database name "${databaseName}": must match ${DATABASE_NAME_PATTERN.source} (lowercase letters, digits, underscores).`,
    );
  }
}

function describeTestDatabaseUrlContract(): string {
  return [
    'No PostgreSQL available for integration tests.',
    '',
    'Provide an admin-capable base URL via TEST_DATABASE_URL; the harness creates a',
    'uniquely named temporary database on that server and drops it on teardown.',
    '',
    'Local native Postgres example:',
    '  TEST_DATABASE_URL="postgresql://localhost:5433/postgres" pnpm test:integration',
    '(trust auth: connect as the superuser db to get CREATE DATABASE rights)',
    '',
    'GitHub Actions service-container example:',
    '  TEST_DATABASE_URL=postgres://care_platform_app:ci-password@localhost:5432/care_platform_test',
    '',
    'Alternatively make Docker reachable so Testcontainers can start a disposable',
    'postgres server automatically.',
  ].join('\n');
}

async function resolveAdminTarget(): Promise<AdminTarget> {
  const envUrl = process.env.TEST_DATABASE_URL?.trim();
  if (envUrl) {
    return { adminUri: envUrl };
  }

  try {
    const container = await new PostgreSqlContainer(DEFAULT_TEST_DB_IMAGE).start();
    return { adminUri: container.getConnectionUri(), ownedContainer: container };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${describeTestDatabaseUrlContract()}\n\n(Testcontainers attempt failed: ${reason})`,
    );
  }
}

function withDatabaseName(uri: string, databaseName: string): string {
  const url = new URL(uri);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function withAdminClient<T>(
  adminUri: string,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: adminUri });
  try {
    await client.connect();
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Creates the uniquely named scratch database on the target server. */
export async function createEphemeralDatabase(
  adminUri: string,
  databaseName: string,
): Promise<void> {
  assertValidDatabaseName(databaseName);
  await withAdminClient(adminUri, async (client) => {
    await client.query(`CREATE DATABASE "${databaseName}"`);
  });
}

/** Terminates remaining connections and drops the scratch database. Idempotent-safe via IF EXISTS. */
export async function dropEphemeralDatabase(adminUri: string, databaseName: string): Promise<void> {
  assertValidDatabaseName(databaseName);
  await withAdminClient(adminUri, async (client) => {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  });
}

/**
 * Provisions a fresh, uniquely named test database:
 *
 * 1. `TEST_DATABASE_URL` set → use it as the admin base URL (native Postgres path).
 * 2. Docker reachable → start a disposable Testcontainers postgres.
 * 3. Otherwise → throw with instructions (see {@link describeTestDatabaseUrlContract}).
 *
 * The returned database has the current Drizzle migrations applied (missing
 * migrations are fatal — generate them first) and is destroyed by
 * `teardown()`.
 */
export async function createTestDatabase(
  options: CreateTestDatabaseOptions = {},
): Promise<TestDatabase> {
  const target = await resolveAdminTarget();

  // Uniquely named per call so parallel suites and repeated runs never share state.
  const databaseName = `care_platform_test_${randomBytes(6).toString('hex')}`;
  const uri = withDatabaseName(target.adminUri, databaseName);

  let handle!: DatabaseClient;
  try {
    // Inside the guarded scope so a failed CREATE DATABASE still disposes an
    // owned Testcontainers container below.
    await createEphemeralDatabase(target.adminUri, databaseName);
    handle = createDatabaseClient({ url: uri, max: options.max ?? 5 });
    await runMigrations(handle, { migrationsFolder: options.migrationsFolder });
  } catch (error) {
    await handle?.$client.end().catch(() => undefined);
    await dropEphemeralDatabase(target.adminUri, databaseName).catch(() => undefined);
    if (target.ownedContainer) {
      await target.ownedContainer.stop().catch(() => undefined);
    }
    throw error;
  }

  let tornDown = false;
  const teardown = async (): Promise<void> => {
    if (tornDown) {
      return;
    }
    tornDown = true;

    await handle.$client.end();
    await dropEphemeralDatabase(target.adminUri, databaseName);
    if (target.ownedContainer) {
      await target.ownedContainer.stop();
    }
  };

  return { db: handle, client: handle.$client, uri, teardown };
}
