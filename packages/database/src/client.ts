import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

/**
 * Drizzle database handle bound to a node-postgres pool.
 *
 * The underlying pool is always available via `$client` so callers can close
 * it explicitly (integration harnesses) or reuse it for raw SQL that must not
 * go through the query builder.
 */
export type DatabaseClient = NodePgDatabase<Record<string, never>> & {
  $client: Pool;
};

/**
 * Connection/pool configuration for {@link createDatabaseClient}.
 */
export interface DatabaseConfig {
  /** PostgreSQL connection string, e.g. postgres://user:pass@host:5432/db. */
  url: string;
  /**
   * Explicit TLS toggle. When omitted, no `ssl` option is forwarded to the
   * pool so the connection string's `sslmode` parameter governs TLS behavior.
   * Set `true`/`false` to force TLS on/off regardless of the URL.
   */
  ssl?: boolean;
  /** Maximum pool size. Default 10. */
  max?: number;
  /** Idle client timeout in ms. Default 30_000. */
  idleTimeoutMillis?: number;
  /** Connection acquisition timeout in ms. Default 5_000. */
  connectionTimeoutMillis?: number;
}

const TRUTHY_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Reads database configuration from environment variables.
 *
 * - `DATABASE_URL` (required): PostgreSQL connection string.
 * - `DATABASE_SSL` (optional): set to force TLS on/off ("1"/"true"/"yes"/"on"
 *   enable; other values disable). When unset, the URL's `sslmode` governs.
 * - `DATABASE_POOL_MAX` (optional): maximum pool size.
 *
 * Throws a descriptive error when `DATABASE_URL` is missing so processes fail
 * fast at startup instead of on first query.
 */
export function readDatabaseConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  const url = env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new Error(
      'DATABASE_URL is required to create a database client. Example: postgres://user:password@localhost:5432/care_platform',
    );
  }

  const sslRaw = env.DATABASE_SSL?.trim().toLowerCase();

  return {
    url,
    ...(sslRaw === undefined ? {} : { ssl: TRUTHY_ENV_VALUES.has(sslRaw) }),
    ...(env.DATABASE_POOL_MAX === undefined
      ? {}
      : { max: parsePositiveInt(env.DATABASE_POOL_MAX) }),
  };
}

function toPoolConfig(config: DatabaseConfig): PoolConfig {
  // Sane defaults for a modular-monolith API process; callers may override.
  return {
    connectionString: config.url,
    // Only forward `ssl` when explicitly configured; otherwise the connection
    // string's `sslmode` parameter must reach the driver untouched.
    ...(config.ssl === undefined ? {} : { ssl: config.ssl }),
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5_000,
  };
}

/**
 * Creates a Drizzle database handle backed by a node-postgres pool.
 *
 * The caller owns the returned handle's lifecycle; close the pool with
 * `handle.$client.end()` when shutting down.
 */
export function createDatabaseClient(config: DatabaseConfig): DatabaseClient {
  const pool = new Pool(toPoolConfig(config));
  return drizzle({ client: pool }) as DatabaseClient;
}
