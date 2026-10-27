import { defineConfig } from '@playwright/test';

// The AI eval (#706): real models on this machine's GPU, so it runs locally and never in CI.
// `npm run e2e` never picks it up: its projects match *.spec.ts, and this config only *.eval.ts.
// Run it with `npm run eval:ai -- <model id>` or `npm run eval:ai -- --all` (e2e/evals/run.mjs).
export default defineConfig({
  testDir: 'e2e/evals',
  testMatch: '**/*.eval.ts',
  outputDir: 'test-results/evals',
  reporter: 'list',
  workers: 1,
  retries: 0,
  // A model runs 20 tasks, and its first run downloads it.
  timeout: 2 * 60 * 60_000,
  use: { baseURL: 'http://127.0.0.1:5174', actionTimeout: 60_000 },
  webServer: {
    command: 'vite --mode e2e --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    // Another checkout's dev server on this port would be evaluated in place of this one.
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
