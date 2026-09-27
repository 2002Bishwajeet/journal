import { defineConfig, devices } from '@playwright/test';

const isDevServer = process.env.E2E_SERVER === 'dev';

const baseURL = isDevServer ? 'http://127.0.0.1:5174' : 'http://127.0.0.1:4173';

const webServerCommand = isDevServer
  ? 'vite --mode e2e --host 127.0.0.1 --port 5174 --strictPort'
  : 'vite build --mode e2e --outDir dist-e2e && vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port 4173 --strictPort';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  reporter: [['list'], ['html', { open: 'never' }]],
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 2 : 0,
  fullyParallel: false,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: webServerCommand,
    url: baseURL,
    // Only the HMR dev server stays current when reused. Reusing whatever is on
    // 4173 would skip the build and test a stale (or foreign) bundle.
    reuseExistingServer: isDevServer && !process.env.CI,
    timeout: 300_000,
  },
  projects: [
    {
      name: 'hermetic',
      testIgnore: ['**/*.live.spec.ts', 'edge/**'],
      grepInvert: /@quarantine/,
      // Service-worker fetches can bypass context.route(), which would let them
      // slip past the network fence. SW behaviour belongs in the live layer.
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
    },
  ],
});
