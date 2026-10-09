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
const needsAppServer = runsAll || requestedProjects.some((p) => p !== 'edge');
const needsEdgeServer = (runsAll || requestedProjects.includes('edge')) && !process.env.E2E_EDGE_BASE_URL;
// Web servers start in order; when the preview server already built dist-e2e,
// rebuilding it here would pull the files out from under that server.
const edgeBuildsItself = !needsAppServer || isDevServer;

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
      testIgnore: ['**/*.live.spec.ts', 'edge/**'],
      grepInvert: /@quarantine/,
      // Service-worker fetches can bypass context.route(), which would let them
      // slip past the network fence. SW behaviour belongs in the live layer.
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
    },
    {
      name: 'quarantine',
      testIgnore: ['**/*.live.spec.ts', 'edge/**'],
      grep: /@quarantine/,
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'block' },
    },
    {
      name: 'edge',
      testDir: 'e2e/edge',
      // Its specs each bind the one upstream stub port (8799) the edge server points at.
      workers: 1,
      use: { ...devices['Desktop Chrome'], baseURL: edgeBaseURL, serviceWorkers: 'block' },
    },
  ],
});
