import type { DatabaseClient } from '@commerce-platform/database';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';

/**
 * Transaction handle shape produced by `DatabaseClient.transaction(...)`.
 * Kept structurally identical to the client's generics so repository methods
 * accept either the root pool-backed handle or an open transaction.
 */
export type CatalogDbTransaction = PgTransaction<
  NodePgQueryResultHKT,
  Record<string, never>,
  ExtractTablesWithRelations<Record<string, never>>
>;

/**
 * Anything that can execute queries for this context: the root database
 * handle or an in-progress transaction. Application services pass their open
 * transaction so load/save of one aggregate always shares one local
 * transaction boundary (docs/architecture/30-persistence-overview.md).
 */
export type DbExecutor = DatabaseClient | CatalogDbTransaction;
