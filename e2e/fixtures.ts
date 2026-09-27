import { test as base, expect, type Page } from '@playwright/test';
import { assertAllowedOrigin, assertTestOrigin } from './support/origin-guard';
import { installNetworkFence, assertNoFenceViolations } from './support/network-fence';

export { expect };

// The hooks module is dynamically imported, so it may not be installed yet
// right after a navigation or reload.
export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__journalE2E !== undefined);
  await page.evaluate(() => window.__journalE2E!.ready());
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
  // Array form (matching assertBaseUrlIsTestOrigin above) sidesteps an
  // eslint-plugin-react-hooks false positive: it infers a name for a function
  // assigned directly to an object property and then flags that function's
  // `use(...)` call as an invalid Hook call, since the inferred name ("context")
  // doesn't start with "use".
  context: [
    async ({ context }, use) => {
      const { violations } = await installNetworkFence(context);
      await use(context);
      assertNoFenceViolations(violations);
    },
    { scope: 'test' },
  ],

  // A signed-in, fully booted app page. `app` opens its own context (rather
  // than reusing `context`) so it can supply the hermetic storageState.
  app: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ storageState: 'e2e/fixtures/hermetic-auth.json' });
      const { violations } = await installNetworkFence(context);
      const page = await context.newPage();

      await page.goto('/');
      await assertTestOrigin(page);
      await waitForAppReady(page);

      await use(page);

      await context.close();
      assertNoFenceViolations(violations);
    },
    {},
  ],

  // A signed-out page: same origin allowlist and network fence, no storageState.
  anonPage: [
    async ({ browser }, use) => {
      const context = await browser.newContext();
      const { violations } = await installNetworkFence(context);
      const page = await context.newPage();

      await use(page);

      await context.close();
      assertNoFenceViolations(violations);
    },
    {},
  ],
});
