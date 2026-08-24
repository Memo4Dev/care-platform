import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Workspace packages are consumed from TypeScript sources in tests so gates
// never depend on a prior build step; production builds use package dists.
const workspaceSourceAlias = {
  '@commerce-platform/database': fileURLToPath(
    new URL('./packages/database/src/index.ts', import.meta.url),
  ),
};

// Integration run (`pnpm test:integration`): every *.integration.spec.ts
// across apps/packages against real PostgreSQL (see packages/testing).
export default defineConfig({
  resolve: {
    alias: workspaceSourceAlias,
  },
  test: {
    include: ['apps/**/*.integration.spec.ts', 'packages/**/*.integration.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/coverage/**'],
    environment: 'node',
    globals: true,
    // Provisioning databases and (in CI) containers takes longer than unit work.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
