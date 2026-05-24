import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    pool: 'forks',
    setupFiles: ['reflect-metadata'],
    testTimeout: 10_000,
    passWithNoTests: true,
    coverage: { provider: 'v8', reportsDirectory: '../coverage' },
  },
});
