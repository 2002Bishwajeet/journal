import { test as base, expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { assertAllowedOrigin, assertTestOrigin, isRemoteEdgeRun } from './support/origin-guard';
import { installNetworkFence, assertNoFenceViolations } from './support/network-fence';
import { createFolder, selectFolder } from './support/actions';
import { existsSync } from 'node:fs';

export { expect };

export const LIVE_STORAGE_STATE = 'e2e/.auth/live.json';
export const LIVE_PEER_STORAGE_STATE = 'e2e/.auth/live-peer.json';
export const LIVE_OUTSIDER_STORAGE_STATE = 'e2e/.auth/live-outsider.json';
export const LIVE_CIRCLE_NAME = 'E2E collaborators';

// The other two dev identities the e2e/sharing specs need (#676), next to the
// owner (E2E_LIVE_IDENTITY). Only e2e/live/ci-bootstrap.ts (Docker tier) writes
// their storage state.
export const LIVE_SHARING_IDENTITIES = [
  { role: 'peer', identity: process.env.E2E_LIVE_PEER_IDENTITY || 'sam.dotyou.cloud', storageState: LIVE_PEER_STORAGE_STATE },
  { role: 'outsider', identity: process.env.E2E_LIVE_OUTSIDER_IDENTITY || 'merry.dotyou.cloud', storageState: LIVE_OUTSIDER_STORAGE_STATE },
] as const;

export type LiveIdentityPage = { page: Page; identity: string };

// The real identity the live tier may talk to, beyond the app origin.
export function liveIdentityOrigin(): string {
  if (!process.env.E2E_LIVE_IDENTITY) {
    throw new Error('E2E_LIVE_IDENTITY must be set for the live tier — see npm run e2e:login.');
  }
  return `https://${process.env.E2E_LIVE_IDENTITY}`;
}

// The hooks module is dynamically imported, so it may not be installed yet
// right after a navigation or reload.
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__journalE2E !== undefined);
  await page.evaluate(() => window.__journalE2E!.ready());
}

// Marks every release as already seen, so the "What's new" dialog never covers
// a live page whose storage state predates the current version. Call before
// the first navigation.
export async function skipWhatsNew(page: Page): Promise<void> {
  await page.context().addInitScript(() => localStorage.setItem('journal-last-seen-version', '999.0.0'));
}

// Runs `body` with a page in a new fenced context. The context is closed even
// if `body` throws, so a failed boot doesn't leak it.
export async function withFencedPage(
  browser: Browser,
  options: BrowserContextOptions,
  body: (page: Page) => Promise<void>,
  extraOrigins: string[] = [],
): Promise<void> {
  const context = await browser.newContext(options);
  const { violations } = await installNetworkFence(context, extraOrigins);
  try {
    await body(await context.newPage());
  } finally {
    await context.close();
  }
  assertNoFenceViolations(violations);
}

// e2e/fixtures/hermetic-auth.json's IDENTITY/BX0900/APSS values are fake by
// construction (a `.test` identity and fixed bytes, not real credentials) —
// see that file and the "no fake drive" policy in issue #196.

// Auto fixture: fails fast, before any test body runs, if the configured
// baseURL isn't one of the allowlisted test origins. Catches a misconfigured
// run (e.g. E2E_SERVER pointed somewhere else) before it can touch a page.
// A booted page that has served many tests (mounted editors, a long note list)
// slows until hovers time out, and a reload doesn't cure it, so the shared page
// is replaced by a fresh context after this many tests.
const REUSED_APP_RECYCLE_EVERY = 8;
type AppPool = { next(): Promise<Page> };

export const test = base.extend<{
  assertBaseUrlIsTestOrigin: void;
  app: Page;
  reusedApp: Page;
  anonPage: Page;
}, {
  bootedApp: AppPool;
  liveRun: { page: Page; folderName: string };
  liveSharing: { owner: LiveIdentityPage; peer: LiveIdentityPage; outsider: LiveIdentityPage; circleName: string };
}>({
  assertBaseUrlIsTestOrigin: [
    async ({ baseURL }, use, testInfo) => {
      if (!isRemoteEdgeRun(testInfo.project.name, baseURL)) assertAllowedOrigin(baseURL);
      await use();
    },
    { auto: true },
  ],

  // Applies the network fence to the default `context` (and therefore the
  // default `page`) fixture every spec gets for free.
  // Fixtures use array form because react-hooks lint otherwise flags `use()`
  // inside a function it names after the property (e.g. "context").
  context: [
    async ({ context, baseURL }, use, testInfo) => {
      testInfo.skip(isRemoteEdgeRun(testInfo.project.name, baseURL), 'browser tests never run against a deployed URL');
      const { violations } = await installNetworkFence(context);
      await use(context);
      assertNoFenceViolations(violations);
    },
    { scope: 'test' },
  ],

  // A signed-in, fully booted app page, in its own context so it can supply
  // the hermetic storageState.
  app: [
    async ({ browser }, use) =>
      withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json' }, async (page) => {
        await page.goto('/');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await use(page);
      }),
    {},
  ],

  // `app` booted once per worker and shared by the tests that ask for it (#612):
  // the boot is ~3 s of each test. Only for specs whose tests don't depend on a
  // clean drive (each makes its own uniquely titled note) or on a test-scoped
  // option (a viewport or colour scheme). Between tests it puts back the viewport,
  // colour scheme and tabs.
  bootedApp: [
    async ({ browser }, use) => {
      let release: (() => void) | undefined;
      let done: Promise<void> | undefined;
      let uses = 0;
      let current: Page | undefined;
      const open = () =>
        new Promise<Page>((resolve, reject) => {
          done = withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json' }, async (page) => {
            await page.goto('/');
            await assertTestOrigin(page);
            await waitForAppReady(page);
            resolve(page);
            await new Promise<void>((r) => (release = r));
          }).catch(reject);
        });
      const close = async () => {
        release?.();
        await done;
        current = undefined;
      };
      await use({
        async next() {
          if (current && uses >= REUSED_APP_RECYCLE_EVERY) await close();
          if (!current) uses = 0;
          uses++;
          return (current ??= await open());
        },
      });
      await close();
    },
    { scope: 'worker' },
  ],

  reusedApp: [
    async ({ bootedApp }, use) => {
      const page = await bootedApp.next();
      const viewport = page.viewportSize();
      await use(page);
      if (viewport) await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: null });
      // Open notes stay mounted as background tabs, which makes unscoped locators
      // (a toolbar button, say) match once per tab.
      const closeTab = page.getByRole('button', { name: /^Close (?!assistant)/ });
      while ((await closeTab.count()) > 0) await closeTab.first().click();
    },
    {},
  ],

  // A signed-out page: same origin allowlist and network fence, no storageState.
  anonPage: [async ({ browser }, use) => withFencedPage(browser, {}, use), {}],

  // A signed-in page on the real identity (E2E_LIVE_IDENTITY), scoped to this
  // run's own folder. Worker-scoped so the live specs share one folder; the
  // worker suffix keeps a restarted worker (after a failure) from creating a
  // duplicate name. e2e/live/global-teardown.ts deletes `${E2E_LIVE_RUN_FOLDER}-w*`.
  liveRun: [
    async ({ browser }, use, { workerIndex }) => {
      const folderName = `${process.env.E2E_LIVE_RUN_FOLDER}-w${workerIndex}`;
      await withFencedPage(browser, { storageState: LIVE_STORAGE_STATE }, async (page) => {
        await skipWhatsNew(page);
        await page.goto('/');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await createFolder(page, folderName);
        await selectFolder(page, folderName);
        await use({ page, folderName });
      }, [liveIdentityOrigin()]);
    },
    { scope: 'worker' },
  ],

  // Three signed-in pages for the e2e/sharing specs (#676): the owner (liveRun's
  // page, in the run folder), a peer in the owner's LIVE_CIRCLE_NAME circle, and
  // an outsider connected to the owner but in no circle. Each page may reach only
  // its own identity. Only the Docker tier (ci-bootstrap.ts) writes the peer and
  // outsider storage state, so the hand-login tier skips these specs.
  liveSharing: [
    async ({ browser, liveRun }, use) => {
      const missing = LIVE_SHARING_IDENTITIES.filter(({ storageState }) => !existsSync(storageState));
      base.skip(
        missing.length > 0,
        `needs ${missing.map((m) => m.storageState).join(' and ')}, which only npm run e2e:live:docker's setup writes`,
      );
      const [peer, outsider] = LIVE_SHARING_IDENTITIES;
      const owner = { page: liveRun.page, identity: process.env.E2E_LIVE_IDENTITY! };
      const identities = [owner.identity, peer.identity, outsider.identity];
      // Two things the app fetches straight from another person's identity:
      // their avatar (public /pub/image, for circle members and note authors),
      // and, on a peer's page, the author's guest websocket for realtime peer
      // updates (usePeerNoteWebsocket). Answer both here so nothing reaches the
      // network and each page still reaches only its own identity; the spec
      // reloads instead of relying on realtime. Registered on the context after
      // the fence (so they win, and service-worker fetches are caught too).
      const stubOtherIdentities = async ({ page, identity }: LiveIdentityPage) => {
        for (const other of identities.filter((id) => id !== identity)) {
          await page.context().route(`https://${other}/pub/image**`, (route) => route.fulfill({ status: 404 }));
          await page.context().routeWebSocket(`wss://${other}/api/guest/v1/notify/peer/ws**`, (ws) => ws.close());
        }
      };
      const signedIn = (
        { identity, storageState }: (typeof LIVE_SHARING_IDENTITIES)[number],
        body: (signedInPage: LiveIdentityPage) => Promise<void>,
      ) =>
        withFencedPage(browser, { storageState }, async (page) => {
          await stubOtherIdentities({ page, identity });
          await skipWhatsNew(page);
          await page.goto('/');
          await assertTestOrigin(page);
          await waitForAppReady(page);
          await body({ page, identity });
        }, [`https://${identity}`]);

      await stubOtherIdentities(owner);
      await signedIn(peer, (peerPage) =>
        signedIn(outsider, (outsiderPage) =>
          use({ owner, peer: peerPage, outsider: outsiderPage, circleName: LIVE_CIRCLE_NAME })));
    },
    { scope: 'worker' },
  ],
});
