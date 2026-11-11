import { defineConfig } from 'vitest/config';
import { pieceStubs } from './test/pieceStubs';

// This package's tests on their own (the release workflow). Journal's vitest.config.ts runs
// the same unit tests with its own; test/published/ is only run here, on the built package.
export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
  },
  resolve: { alias: pieceStubs },
});
