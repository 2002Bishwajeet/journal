import { defineConfig } from '@playwright/test';

// Raw store captures (brand/store/README.md). Needs the e2e dev server:
//   npx vite --mode e2e --host 127.0.0.1 --port 5174
export default defineConfig({
  testDir: '.',
  testMatch: '*.capture.ts',
  outputDir: '../../../test-results/store-capture',
  workers: 1,
  timeout: 180_000,
  reporter: 'list',
  use: { actionTimeout: 10_000, baseURL: 'http://127.0.0.1:5174', serviceWorkers: 'block' },
});
