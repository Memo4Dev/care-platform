import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/**/*.spec.ts'],
    environment: 'node',
    globals: true,
  },
});
