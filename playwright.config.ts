import { defineConfig, devices } from '@playwright/test';

const isDevServer = process.env.E2E_SERVER === 'dev';

const baseURL = isDevServer ? 'http://127.0.0.1:5174' : 'http://127.0.0.1:4173';

// The edge project serves the build the way Cloudflare Pages does (_headers,
// _redirects, functions/), or targets a deployed URL for its request-only specs.
const edgeBaseURL = process.env.E2E_EDGE_BASE_URL ?? 'http://127.0.0.1:8788';

const buildCommand = 'vite build --mode e2e --outDir dist-e2e';

const webServerCommand = isDevServer
  ? 'vite --mode e2e --host 127.0.0.1 --port 5174 --strictPort'
  : `${buildCommand} && vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port 4173 --strictPort`;

// webServer is global, so start only the servers the requested projects need.
const argv = process.argv;
const requestedProjects = argv.flatMap((arg, i) =>
  arg.startsWith('--project=') ? [arg.slice('--project='.length)] : arg === '--project' ? [argv[i + 1]] : [],
);
const runsAll = requestedProjects.length === 0;
const needsAppServer = runsAll || requestedProjects.some((p) => p !== 'edge' && p !== 'recorded');
const needsRecordedServer = runsAll || requestedProjects.includes('recorded');
const needsEdgeServer = (runsAll || requestedProjects.includes('edge')) && !process.env.E2E_EDGE_BASE_URL;
// Web servers start in order; only the first one serving dist-e2e builds it —
// rebuilding it later would pull the files out from under an earlier server.
const appBuilds = needsAppServer && !isDevServer;
const recordedBuildsItself = !appBuilds;
const edgeBuildsItself = !appBuilds && !needsRecordedServer;

// The HTTPS origin shared by the `recorded` project here and the live tier
// (playwright.live.config.ts, #204). e2e:live:docker (#203/local) sets
// E2E_LIVE_DOCKER=1 to route the identity domain at Chromium's resolver instead
// of /etc/hosts, which that flow never touches — see e2e/live/docker.sh.
// Hand-login (`npm run e2e:live`) targets whatever identity the user logged
// into, so it must NOT force that identity onto 127.0.0.1.
const liveIdentity = process.env.E2E_LIVE_IDENTITY;
const dockerMap =
  process.env.E2E_LIVE_DOCKER && liveIdentity
    ? `,MAP ${liveIdentity} 127.0.0.1,MAP capi.${liveIdentity} 127.0.0.1,MAP file.${liveIdentity} 127.0.0.1`
    : '';
export const httpsUse = {
  ...devices['Desktop Chrome'],
  baseURL: 'https://e2e.dotyou.cloud:4443',
  ignoreHTTPSErrors: true,
  // Playwright's ignoreHTTPSErrors alone isn't enough for the service worker
  // to register on the self-signed origin.
  launchOptions: {
    args: [`--host-resolver-rules=MAP e2e.dotyou.cloud 127.0.0.1${dockerMap}`, '--ignore-certificate-errors'],
  },
};

const httpsPreview = 'E2E_HTTPS=1 vite preview --mode e2e --outDir dist-e2e --host 127.0.0.1 --port 4443 --strictPort';
export const httpsWebServer = {
  command: `node e2e/support/make-cert.mjs && ${buildCommand} && ${httpsPreview}`,
  // Not `url`: Playwright's readiness probe is a plain Node request that
  // can't see Chromium's --host-resolver-rules, so probe the port instead.
  port: 4443,
  timeout: 300_000,
};

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
  webServer: [
    ...(needsAppServer
      ? [{
          command: webServerCommand,
          url: baseURL,
          // Only the HMR dev server stays current when reused. Reusing whatever is on
          // 4173 would skip the build and test a stale (or foreign) bundle.
          reuseExistingServer: isDevServer && !process.env.CI,
          timeout: 300_000,
        }]
      : []),
    ...(needsRecordedServer
      ? [{
          ...httpsWebServer,
          command: recordedBuildsItself ? httpsWebServer.command : `node e2e/support/make-cert.mjs && ${httpsPreview}`,
        }]
      : []),
    ...(needsEdgeServer
      ? [{
          // Pinned to the deploy's wranglerVersion (deploy-cloudflare.yml). Not a
          // package.json dependency: its workerd binaries would churn the lockfile.
          command: `${edgeBuildsItself ? `${buildCommand} && ` : ''}npx --yes wrangler@3.90.0 pages dev dist-e2e --ip 127.0.0.1 --port 8788 --binding HOMEBASE_UPSTREAM_OVERRIDE=http://127.0.0.1:8799`,
          url: edgeBaseURL,
          reuseExistingServer: false,
          timeout: 300_000,
        }]
      : []),
  ],
  projects: [
    {
      name: 'hermetic',
      testIgnore: ['**/*.live.spec.ts', '**/*.recorded.spec.ts', 'edge/**'],
      grepInvert: /@quarantine/,
      // Service-worker fetches can bypass context.route(), which would let them
      // slip past the network fence. SW behaviour belongs in the live layer.
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
    },
    {
      name: 'quarantine',
      testIgnore: ['**/*.live.spec.ts', '**/*.recorded.spec.ts', 'edge/**'],
      grep: /@quarantine/,
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
    },
    {
      // Layer 2 (#202): replays e2e/har/** (e2e/support/har.ts), on the same
      // origin the recording was made on so the recorded CORS headers match.
      // One worker, so a recording run shares one run id (e2e/support/har.ts).
      // SW fetches could bypass context.route() and so the recording, as in hermetic.
      name: 'recorded',
      testMatch: '**/*.recorded.spec.ts',
      workers: 1,
      use: { ...httpsUse, storageState: 'e2e/har/replay-auth.json', serviceWorkers: 'block' },
    },
    {
      name: 'edge',
      testDir: 'e2e/edge',
      use: { ...devices['Desktop Chrome'], baseURL: edgeBaseURL, serviceWorkers: 'block' },
    },
  ],
});
