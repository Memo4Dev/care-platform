import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Workspace packages are consumed from TypeScript sources in tests so gates
// never depend on a prior build step; production builds use package dists.
const workspaceSourceAlias = {
  '@commerce-platform/database': fileURLToPath(
    new URL('./packages/database/src/index.ts', import.meta.url),
  ),
};

// Fast/unit-only run (`pnpm test`). Integration specs (*.integration.spec.ts)
// are excluded here and run via `pnpm test:integration` instead.
export default defineConfig({
  resolve: {
    alias: workspaceSourceAlias,
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    include: ['apps/**/*.spec.ts', 'packages/**/*.spec.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      'apps/**/*.integration.spec.ts',
      'packages/**/*.integration.spec.ts',
    ],
    environment: 'node',
    globals: true,
  },
});
