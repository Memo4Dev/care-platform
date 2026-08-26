import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { DatabaseClient } from './client';

/** Marker file that identifies a Drizzle migrations folder. */
const MIGRATIONS_MARKER = path.join('meta', '_journal.json');

/**
 * Directory containing this module in both of its execution modes:
 *
 * - Compiled CommonJS output (`dist/migrator.js`): `__dirname`.
 * - TypeScript sources executed as ESM (vitest aliases this package's `src/`):
 *   derived from a captured stack frame. `import.meta` cannot be referenced
 *   directly because it is illegal syntax under the package's CommonJS emit
 *   and would make `dist/*.js` unloadable by Node.
 *
 * Returns `null` when the executing file cannot be determined.
 */
function currentModuleDir(): string | null {
  if (typeof __dirname === 'string') {
    return __dirname;
  }

  const originalPrepareStackTrace = Error.prepareStackTrace;
  try {
    const probe = new Error();
    Error.prepareStackTrace = (_error, frames) => frames;
    const frames = probe.stack as unknown as NodeJS.CallSite[];
    const thisFile = frames[0]?.getFileName();
    if (!thisFile) {
      return null;
    }
    return path.dirname(thisFile.startsWith('file:') ? fileURLToPath(thisFile) : thisFile);
  } catch {
    return null;
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }
}

/**
 * Resolves the generated SQL migrations folder shipped with this package
 * (`packages/database/drizzle`).
 *
 * Resolution order:
 * 1. explicit {@link override} when provided (relative paths resolve against
 *    `process.cwd()`, as CLI conventions dictate),
 * 2. walking upward from this module's own directory — `src/` when executed
 *    as TypeScript sources, `dist/` after compilation — until a directory
 *    containing `drizzle/meta/_journal.json` is found.
 *
 * Module-relative on purpose: results are identical no matter which working
 * directory a process boots from. Returns `null` when nothing matches so
 * callers decide whether that is fatal.
 */
export function resolveMigrationsFolder(override?: string): string | null {
  const candidates: string[] = [];
  if (override) {
    candidates.push(path.resolve(override));
  }

  const moduleDir = currentModuleDir();
  if (moduleDir) {
    let dir = moduleDir;
    for (;;) {
      candidates.push(path.join(dir, 'drizzle'));
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, MIGRATIONS_MARKER))) {
      return candidate;
    }
  }

  return null;
}

/**
 * Applies pending Drizzle migrations to the database behind {@link db}.
 *
 * Safe to call on every boot: already-applied statements are skipped via the
 * `drizzle.__drizzle_migrations` bookkeeping table.
 *
 * A missing migrations folder is fatal: generate the SQL set first with
 * `pnpm --filter @commerce-platform/database generate`. Callers that genuinely
 * need an explicit location can pass {@link options.migrationsFolder}.
 */
export async function runMigrations(
  db: DatabaseClient,
  options: { migrationsFolder?: string } = {},
): Promise<void> {
  const migrationsFolder = resolveMigrationsFolder(options.migrationsFolder);

  if (!migrationsFolder) {
    const searchedFrom = currentModuleDir() ?? '<unknown module location>';
    throw new Error(
      [
        'Unable to locate the Drizzle migrations folder.',
        `Searched upward from ${searchedFrom} for drizzle/${MIGRATIONS_MARKER}.`,
        'Generate it with: pnpm --filter @commerce-platform/database generate',
      ].join('\n'),
    );
  }

  await migrate(db, { migrationsFolder });
}
