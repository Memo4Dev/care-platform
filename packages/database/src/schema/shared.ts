import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidV7 } from 'uuid';

/**
 * Shared column helpers for all logical schemas.
 *
 * Conventions (docs/architecture/30-persistence-overview.md):
 * - Technical IDs are UUIDv7, generated application-side so IDs exist before
 *   insert (useful for offline clients, idempotent retries and ordered keys).
 * - Tenant-owned tables carry `organization_id`; business uniqueness is
 *   expressed as UNIQUE (organization_id, business_key).
 * - Mutable aggregates carry an optimistic concurrency version column.
 * - Money/quantities are `numeric`, never float. Timestamps are `timestamptz`.
 *
 * DB-side generation via `gen_random_uuid()` (see
 * {@link idColumnDbGenerated}) is a fallback only; prefer app-side UUIDv7.
 */

/**
 * Generates a new UUIDv7 string (time-ordered, RFC 9562).
 *
 * App-side generation keeps IDs available before persistence and orders rows
 * by creation time without a sequence.
 */
export function newId(): string {
  return uuidV7();
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns true when {@link value} is a syntactically valid UUIDv7 string. */
export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

/**
 * Primary-key column helper: `id uuid PRIMARY KEY` with app-side UUIDv7
 * default. Use in every table instead of hand-rolling the column.
 */
export function idColumn(name = 'id') {
  return uuid(name)
    .primaryKey()
    .$defaultFn(() => newId());
}

/**
 * Fallback primary-key column using DB-side `gen_random_uuid()`.
 *
 * Only use this where the database must generate IDs (e.g. writes that bypass
 * the application). Prefer {@link idColumn} everywhere else.
 */
export function idColumnDbGenerated(name = 'id') {
  return uuid(name).primaryKey().defaultRandom();
}

/**
 * Standard audit timestamp columns: `created_at` / `updated_at`, both
 * `timestamptz NOT NULL DEFAULT now()` (UTC stored, timezone-aware).
 *
 * Spread into table definitions:
 *
 * ```ts
 * export const things = pgTable('things', {
 *   id: idColumn(),
 *   ...timestamps,
 *   version: optimisticVersion,
 * });
 * ```
 */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Optimistic concurrency column for mutable aggregates:
 * `version integer NOT NULL DEFAULT 1`.
 *
 * Aggregates increment the version as part of the same transaction as the
 * state change; updates must guard on the version they read.
 */
export const optimisticVersion = integer('version').notNull().default(1);

/**
 * Parameterized variant of {@link optimisticVersion} for tables that need a
 * different column name.
 */
export function optimisticVersionColumn(name = 'version') {
  return integer(name).notNull().default(1);
}
