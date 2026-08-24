import { randomUUID } from 'node:crypto';
import { getTableColumns } from 'drizzle-orm';
import { pgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  idColumn,
  isUuidV7,
  newId,
  optimisticVersion,
  optimisticVersionColumn,
  timestamps,
} from './schema/shared';

const scratch = pgTable('scratch_helpers', {
  id: idColumn(),
  ...timestamps,
  version: optimisticVersion,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('newId (UUIDv7)', () => {
  it('generates syntactically valid UUIDv7 strings', () => {
    const id = newId();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Version nibble must be 7; variant nibble must be 8/9/a/b.
    expect(isUuidV7(id)).toBe(true);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newId()));

    expect(ids.size).toBe(100);
  });

  it('orders lexicographically by generation time', async () => {
    const first = newId();
    await sleep(3);
    const second = newId();

    expect(second > first).toBe(true);
  });
});

describe('isUuidV7', () => {
  it('rejects UUIDv4 and malformed values', () => {
    expect(isUuidV7(randomUUID())).toBe(false);
    expect(isUuidV7('not-a-uuid')).toBe(false);
    expect(isUuidV7('')).toBe(false);
  });

  it('accepts uppercase input', () => {
    expect(isUuidV7(newId().toUpperCase())).toBe(true);
  });
});

describe('timestamps helper', () => {
  it('exposes timestamptz created_at/updated_at columns with defaults', () => {
    const columns = getTableColumns(scratch);

    expect(columns.createdAt.name).toBe('created_at');
    expect(columns.updatedAt.name).toBe('updated_at');
    expect(columns.createdAt.columnType).toBe('PgTimestamp');
    expect(columns.updatedAt.columnType).toBe('PgTimestamp');
    expect(columns.createdAt.notNull).toBe(true);
    expect(columns.updatedAt.notNull).toBe(true);
    expect(columns.createdAt.hasDefault).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
  });
});

describe('optimisticVersion helper', () => {
  it('exposes an integer version column defaulting to 1', () => {
    const columns = getTableColumns(scratch);

    expect(columns.version.name).toBe('version');
    expect(columns.version.columnType).toBe('PgInteger');
    expect(columns.version.notNull).toBe(true);
    expect(columns.version.default).toBe(1);
  });

  it('supports a custom column name', () => {
    const table = pgTable('scratch_version_named', {
      rowVersion: optimisticVersionColumn('row_version'),
    });
    const columns = getTableColumns(table);

    expect(columns.rowVersion.name).toBe('row_version');
  });
});

describe('idColumn helper', () => {
  it('defines a uuid primary key with an app-side default', () => {
    const columns = getTableColumns(scratch);

    expect(columns.id.name).toBe('id');
    expect(columns.id.columnType).toBe('PgUUID');
    expect(columns.id.primary).toBe(true);
    expect(columns.id.hasDefault).toBe(true);
  });
});
