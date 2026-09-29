import { test as base, expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { assertAllowedOrigin, assertTestOrigin, isRemoteEdgeRun } from './support/origin-guard';
import { installNetworkFence, assertNoFenceViolations } from './support/network-fence';
import { createFolder, selectFolder } from './support/actions';

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
export const test = base.extend<{
  assertBaseUrlIsTestOrigin: void;
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
