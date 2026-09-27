import { test as base, expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { assertAllowedOrigin, assertTestOrigin } from './support/origin-guard';
import { installNetworkFence, assertNoFenceViolations } from './support/network-fence';

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
): Promise<void> {
  const context = await browser.newContext(options);
  const { violations } = await installNetworkFence(context);
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
});
