import { defineConfig } from '@playwright/test';
import base, { httpsUse as use, httpsWebServer } from './playwright.config';

// Layer 3 (#204): a separate config, because `webServer` and globalSetup/
// globalTeardown are config-wide — keeping them here leaves `npm run e2e`
// (playwright.config.ts) with no HTTPS server, no setup/teardown and no route
// to a real identity. The HTTPS origin, launch args (incl. the E2E_LIVE_DOCKER
// resolver rules) and server command are shared with the `recorded` project
// (#202) — see playwright.config.ts.
export default defineConfig({
  ...base,
  globalSetup: './e2e/live/global-setup.ts',
  globalTeardown: './e2e/live/global-teardown.ts',
  webServer: httpsWebServer,
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
