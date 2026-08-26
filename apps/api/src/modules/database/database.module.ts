import {
  createDatabaseClient,
  readDatabaseConfigFromEnv,
  type DatabaseClient,
} from '@commerce-platform/database';
import { Module } from '@nestjs/common';

import { DATABASE } from './database.tokens';

export { DATABASE };

/**
 * Provides the single PostgreSQL connection pool for the API process.
 *
 * Construction fails fast at boot when DATABASE_URL is missing so a
 * misconfigured deployment crashes at startup instead of on first query.
 * The underlying pg Pool connects lazily, so merely wiring the module (e.g.
 * in unit tests) never opens sockets.
 */
@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (): DatabaseClient => createDatabaseClient(readDatabaseConfigFromEnv()),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
