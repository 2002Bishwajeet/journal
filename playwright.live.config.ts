import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// Layer 3 (#204): a separate config, because `webServer` and globalSetup/
// globalTeardown are config-wide — keeping them here leaves `npm run e2e`
// (playwright.config.ts) with no HTTPS server, no setup/teardown and no route
// to a real identity.
//
// e2e:live:docker (#203/local) sets E2E_LIVE_DOCKER=1 to route the identity
// domain at Chromium's resolver instead of /etc/hosts, which that flow never
// touches — see e2e/live/docker.sh. Hand-login (`npm run e2e:live`) targets
// whatever identity the user logged into, so it must NOT force that identity
// onto 127.0.0.1.
const identity = process.env.E2E_LIVE_IDENTITY;
const dockerMap =
  process.env.E2E_LIVE_DOCKER && identity
    ? `,MAP ${identity} 127.0.0.1,MAP capi.${identity} 127.0.0.1,MAP file.${identity} 127.0.0.1`
    : '';
const use = {
  ...devices['Desktop Chrome'],
  baseURL: 'https://e2e.dotyou.cloud:4443',
  ignoreHTTPSErrors: true,
  // Playwright's ignoreHTTPSErrors alone isn't enough for the service worker
  // to register on the self-signed origin.
  launchOptions: {
    args: [`--host-resolver-rules=MAP e2e.dotyou.cloud 127.0.0.1${dockerMap}`, '--ignore-certificate-errors'],
  },
};

export default defineConfig({
  ...base,
  globalSetup: './e2e/live/global-setup.ts',
  globalTeardown: './e2e/live/global-teardown.ts',
  webServer: {
    command:
      'node e2e/support/make-cert.mjs && vite build --mode e2e --outDir dist-e2e && E2E_HTTPS=1 vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port 4443 --strictPort',
    // Not `url`: Playwright's readiness probe is a plain Node request that
    // can't see Chromium's --host-resolver-rules, so probe the port instead.
    port: 4443,
    timeout: 300_000,
  },
  projects: [
    {
      name: 'live',
      testMatch: '**/*.live.spec.ts',
      workers: 1,
      retries: 1,
      use: { ...use, storageState: 'e2e/.auth/live.json' },
    },
    { name: 'live-setup', testMatch: '**/auth.setup.ts', use },
    // CI-only (#203): non-interactive counterpart to 'live-setup', for a
    // freshly booted identity with no human to approve consent.
    { name: 'live-ci-setup', testMatch: '**/ci-bootstrap.ts', use },
  ],
});
