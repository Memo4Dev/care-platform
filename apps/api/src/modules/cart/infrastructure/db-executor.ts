import type { DatabaseClient } from '@commerce-platform/database';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';

export type CartDbTransaction = PgTransaction<
  NodePgQueryResultHKT,
  Record<string, never>,
  ExtractTablesWithRelations<Record<string, never>>
>;

/** Root or transaction executor controlled by the Cart application service. */
export type DbExecutor = DatabaseClient | CartDbTransaction;
