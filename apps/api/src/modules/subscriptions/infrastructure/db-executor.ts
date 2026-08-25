import type { DatabaseClient } from '@commerce-platform/database';

export type DbExecutor =
  DatabaseClient | Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];
