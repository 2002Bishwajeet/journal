import { defineConfig, devices } from '@playwright/test';

const isDevServer = process.env.E2E_SERVER === 'dev';
// Playwright's `webServer` option is global, not per-project — every configured
// server would start regardless of `--project`, so the live HTTPS preview (a
// second full build, on a different port) must be picked deliberately rather
// than always running alongside the hermetic one. Both `npm run e2e:live`
// (`--project=live`) and `npm run e2e:login` (`--project=live-setup`) always
// pass `--project=live...` on argv.
const isLiveProject = process.argv.some((arg) => arg.startsWith('--project=live'));

const baseURL = isDevServer ? 'http://127.0.0.1:5174' : 'http://127.0.0.1:4173';
const liveBaseURL = 'https://e2e.dotyou.cloud:4443';

const webServerCommand = isDevServer
  ? 'vite --mode e2e --host 127.0.0.1 --port 5174 --strictPort'
  : 'vite build --mode e2e --outDir dist-e2e && vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port 4173 --strictPort';

const liveWebServerCommand =
  'node e2e/support/make-cert.mjs && vite build --mode e2e --outDir dist-e2e && E2E_HTTPS=1 vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port 4443 --strictPort';

// The self-signed e2e.dotyou.cloud leaf needs --ignore-certificate-errors, not
// just Playwright's own ignoreHTTPSErrors, or the service worker refuses to
// register on it.
const liveLaunchOptions = {
  args: [
    '--host-resolver-rules=MAP e2e.dotyou.cloud 127.0.0.1',
    '--ignore-certificate-errors',
  ],
};

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  reporter: [['list'], ['html', { open: 'never' }]],
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 2 : 0,
  fullyParallel: false,
  // Names/cleans up the live tier's run-scoped folder on the real identity —
  // a no-op cost for the hermetic project, but only actually useful (and only
  // run) for `live`/`live-setup`.
  globalSetup: isLiveProject ? './e2e/live/global-setup.ts' : undefined,
  globalTeardown: isLiveProject ? './e2e/live/global-teardown.ts' : undefined,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  webServer: isLiveProject
    ? {
        command: liveWebServerCommand,
        // Not `url: liveBaseURL`: Playwright's own readiness probe is a plain
        // Node request with no knowledge of Chromium's --host-resolver-rules,
        // so a `url` fetch to e2e.dotyou.cloud fails DNS resolution outright.
        // `port` makes it a raw TCP connect to 127.0.0.1 instead.
        port: 4443,
        reuseExistingServer: false,
        timeout: 300_000,
      }
    : {
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
    {
      name: 'live',
      testMatch: '**/*.live.spec.ts',
      workers: 1,
      retries: 1,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: liveBaseURL,
        ignoreHTTPSErrors: true,
        storageState: 'e2e/.auth/live.json',
        launchOptions: liveLaunchOptions,
      },
    },
    {
      name: 'live-setup',
      testMatch: '**/auth.setup.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: liveBaseURL,
        ignoreHTTPSErrors: true,
        launchOptions: liveLaunchOptions,
      },
    },
  ],
});
