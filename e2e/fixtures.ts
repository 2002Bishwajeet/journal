import { test as base, expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { assertAllowedOrigin, assertTestOrigin } from './support/origin-guard';
import { installNetworkFence, assertNoFenceViolations } from './support/network-fence';
import { createFolder, selectFolder } from './support/actions';

export { expect };

// The hooks module is dynamically imported, so it may not be installed yet
// right after a navigation or reload.
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__journalE2E !== undefined);
  await page.evaluate(() => window.__journalE2E!.ready());
}

// Runs `body` with a page in a new fenced context. The context is closed even
// if `body` throws, so a failed boot doesn't leak it.
async function withFencedPage(
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
    async ({ baseURL }, use) => {
      assertAllowedOrigin(baseURL);
      await use();
    },
    { auto: true },
  ],

  // Applies the network fence to the default `context` (and therefore the
  // default `page`) fixture every spec gets for free.
  // Fixtures use array form because react-hooks lint otherwise flags `use()`
  // inside a function it names after the property (e.g. "context").
  context: [
    async ({ context }, use) => {
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
  // run's own folder — named once by e2e/live/global-setup.ts (E2E_LIVE_RUN_FOLDER)
  // so e2e/live/global-teardown.ts can find and delete it afterwards. Worker-scoped:
  // the `live` project runs with workers: 1, so every live spec shares the same
  // folder instead of each creating its own.
  liveRun: [
    async ({ browser }, use) => {
      const identity = process.env.E2E_LIVE_IDENTITY;
      if (!identity) {
        throw new Error('E2E_LIVE_IDENTITY must be set to run the `live` project — see npm run e2e:login.');
      }
      const folderName = process.env.E2E_LIVE_RUN_FOLDER;
      if (!folderName) {
        throw new Error('E2E_LIVE_RUN_FOLDER is unset — e2e/live/global-setup.ts should have set it.');
      }

      const context = await browser.newContext({ storageState: 'e2e/.auth/live.json' });
      const { violations } = await installNetworkFence(context, [`https://${identity}`]);
      const page = await context.newPage();
      await page.goto('/');
      await assertTestOrigin(page);
      await waitForAppReady(page);

      await createFolder(page, folderName);
      await selectFolder(page, folderName);

      await use({ page, folderName });

      await context.close();
      assertNoFenceViolations(violations);
    },
    { scope: 'worker' },
  ],
});
