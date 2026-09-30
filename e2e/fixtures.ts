import { test as base, expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';
import { assertAllowedOrigin, assertTestOrigin, isRemoteEdgeRun } from './support/origin-guard';
import { installNetworkFence, assertNoFenceViolations } from './support/network-fence';
import { createFolder, selectFolder, waitForSyncIdle } from './support/actions';
import { recordedTraffic, type RecordedTraffic } from './support/har';

export { expect };

export const LIVE_STORAGE_STATE = 'e2e/.auth/live.json';

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

// Runs `body` with a page in a new fenced context. The context is closed even
// if `body` throws, so a failed boot doesn't leak it. `prepare` runs on the
// context after the fence and before the page opens.
export async function withFencedPage(
  browser: Browser,
  options: BrowserContextOptions,
  body: (page: Page) => Promise<void>,
  extraOrigins: string[] = [],
  prepare?: (context: BrowserContext) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext(options);
  const { violations } = await installNetworkFence(context, extraOrigins);
  await prepare?.(context);
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
export const test = base.extend<{
  assertBaseUrlIsTestOrigin: void;
  recordedTraffic: RecordedTraffic | null;
  app: Page;
  anonPage: Page;
}, {
  liveRun: { page: Page; folderName: string };
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

  // Layer 2 (#202): in the `recorded` project, routes the `app`/`anonPage`
  // contexts through this spec's HAR (e2e/support/har.ts); null elsewhere.
  recordedTraffic: [
    async ({ baseURL }, use, testInfo) => {
      if (testInfo.project.name !== 'recorded') return use(null);
      await recordedTraffic(testInfo, baseURL!, use);
    },
    { auto: true },
  ],

  // A signed-in, fully booted app page, in its own context so it can supply
  // the hermetic storageState (or the recorded session's). In the `recorded`
  // project it works inside its own folder, so a recording never touches
  // anything else on the identity.
  app: [
    async ({ browser, recordedTraffic }, use) =>
      withFencedPage(browser, { storageState: recordedTraffic?.storageState ?? 'e2e/fixtures/hermetic-auth.json' }, async (page) => {
        await page.goto('/');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        if (recordedTraffic) {
          await waitForSyncIdle(page);
          await createFolder(page, recordedTraffic.folderName);
          await selectFolder(page, recordedTraffic.folderName);
        }
        await use(page);
      }, recordedTraffic?.origins, recordedTraffic?.attach),
    {},
  ],

  // A signed-out page: same origin allowlist and network fence, no storageState
  // (explicitly — a project's storageState would otherwise apply here too).
  anonPage: [
    async ({ browser, recordedTraffic }, use) =>
      withFencedPage(browser, { storageState: undefined }, use, recordedTraffic?.origins, recordedTraffic?.attach),
    {},
  ],

  // A signed-in page on the real identity (E2E_LIVE_IDENTITY), scoped to this
  // run's own folder. Worker-scoped so the live specs share one folder; the
  // worker suffix keeps a restarted worker (after a failure) from creating a
  // duplicate name. e2e/live/global-teardown.ts deletes `${E2E_LIVE_RUN_FOLDER}-w*`.
  liveRun: [
    async ({ browser }, use, { workerIndex }) => {
      const folderName = `${process.env.E2E_LIVE_RUN_FOLDER}-w${workerIndex}`;
      await withFencedPage(browser, { storageState: LIVE_STORAGE_STATE }, async (page) => {
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
});
