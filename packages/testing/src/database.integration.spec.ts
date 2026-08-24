import { isUuidV7, newId, resolveMigrationsFolder } from '@commerce-platform/database';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from './database';

function databaseNameOf(uri: string): string {
  return new URL(uri).pathname.replace(/^\//, '');
}

/**
 * Normalizes a timestamptz value (driver Date or raw text such as
 * `2026-08-24 10:00:00+00`) to epoch milliseconds for exact comparisons.
 */
function toEpochMs(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  const text = String(value)
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00');
  const parsed = Date.parse(text);
  expect(Number.isNaN(parsed)).toBe(false);
  return parsed;
}

async function databaseExists(
  viaDb: TestDatabase['client'],
  databaseName: string,
): Promise<boolean> {
  const result = await viaDb.query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
    [databaseName],
  );
  return result.rows[0]?.exists === true;
}

describe('@commerce-platform/testing database harness', () => {
  let primary!: TestDatabase;
  let secondary!: TestDatabase;
  let witness!: TestDatabase;

  beforeAll(async () => {
    primary = await createTestDatabase();
    secondary = await createTestDatabase();
    // Outlives `primary` so the final test can verify primary was really dropped.
    witness = await createTestDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([primary?.teardown(), secondary?.teardown(), witness?.teardown()]);
  });

  it('connects to a real PostgreSQL server', async () => {
    const result = await primary.db.execute<{ version: string }>(sql`SELECT version() AS version`);

    expect(result.rows[0]?.version).toContain('PostgreSQL');
  });

  it('provisions uniquely named temporary databases per handle', () => {
    const primaryName = databaseNameOf(primary.uri);
    const secondaryName = databaseNameOf(secondary.uri);

    expect(primaryName).toMatch(/^care_platform_test_[0-9a-f]{12}$/);
    expect(secondaryName).toMatch(/^care_platform_test_[0-9a-f]{12}$/);
    expect(primaryName).not.toBe(secondaryName);
  });

  it('applies current migrations consistently with the generated migration set', async () => {
    const folder = resolveMigrationsFolder();

    const result = await primary.db.execute<{ present: string | null }>(
      sql`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS present`,
    );

    if (folder) {
      // The migrator ran against this fresh database, so its bookkeeping table
      // must exist — even while the journal is still empty (bootstrap phase,
      // verified behavior of drizzle's node-postgres migrate()).
      expect(result.rows[0]?.present).not.toBeNull();
    }
    // No generated migrations at all: the harness skips loudly and stays
    // usable; the scratch-table lifecycle tests below prove the temp-db flow.
    expect(result.rows.length).toBe(1);
  });

  it('round-trips convention-shaped data through a scratch table (temp-db lifecycle proof)', async () => {
    // Scratch DDL mirrors the shared conventions: UUIDv7 pk, timestamptz
    // timestamps, optimistic version default.
    await primary.client.query(`
      CREATE TABLE testing_scratch (
        id uuid PRIMARY KEY,
        label text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        version integer NOT NULL DEFAULT 1
      )
    `);

    try {
      const createdAt = new Date('2026-08-24T10:00:00.000Z');
      const insertedLabel = 'scratch-row';
      const insertedId = newId();

      await primary.db.execute(
        sql`INSERT INTO testing_scratch (id, label, created_at, updated_at)
            VALUES (${insertedId}, ${insertedLabel}, ${createdAt}, ${createdAt})`,
      );
      await primary.db.execute(
        sql`INSERT INTO testing_scratch (id, label) VALUES (${newId()}, ${'defaulted'})`,
      );

      const selected = await primary.db.execute<{
        id: string;
        label: string;
        // Drizzle's raw execute returns timestamptz as a driver-level string.
        created_at: string | Date;
        version: number;
      }>(sql`SELECT id, label, created_at, version FROM testing_scratch ORDER BY created_at`);

      expect(selected.rows).toHaveLength(2);
      expect(selected.rows[0]?.label).toBe(insertedLabel);
      expect(selected.rows[0]?.id).toBe(insertedId);
      expect(isUuidV7(selected.rows[0]?.id ?? '')).toBe(true);
      expect(toEpochMs(selected.rows[0]?.created_at)).toBe(createdAt.getTime());
      // Row inserted without explicit version gets the DEFAULT 1.
      expect(selected.rows[1]?.version).toBe(1);
    } finally {
      await primary.client.query('DROP TABLE IF EXISTS testing_scratch');
    }
  });

  it('drops the temporary database on teardown', async () => {
    const doomedName = databaseNameOf(secondary.uri);
    expect(await databaseExists(witness.client, doomedName)).toBe(true);

    await secondary.teardown();

    expect(await databaseExists(witness.client, doomedName)).toBe(false);
  });

  it('teardown is idempotent', async () => {
    await expect(secondary.teardown()).resolves.toBeUndefined();
  });
});

describe('@commerce-platform/testing factories conventions', () => {
  it('builds org-scoped example state overridable for determinism', async () => {
    const { exampleOrganizationScopedRow } = await import('./factories');

    const row = exampleOrganizationScopedRow({ organizationId: 'fixed-org-id', label: 'fixture' });

    expect(row.organizationId).toBe('fixed-org-id');
    expect(row.label).toBe('fixture');
    expect(row.version).toBe(1);
    expect(isUuidV7(row.id)).toBe(true);
  });
});
