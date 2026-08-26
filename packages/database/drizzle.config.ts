import { defineConfig } from 'drizzle-kit';

// Drizzle Kit configuration for @commerce-platform/database.
//
// - Schema sources live in ./src/schema (one file per logical domain schema).
// - Generated SQL migrations are emitted to ./drizzle and must be committed.
// - Run `pnpm --filter @commerce-platform/database generate` after schema
//   changes, review the generated SQL, then commit it together with the
//   schema change (see docs/architecture/92-quality-gates.md Database Gate).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema',
  out: './drizzle',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
