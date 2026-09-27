import { test, expect, waitForAppReady } from '../fixtures';
import { installNetworkFence, assertNoFenceViolations } from '../support/network-fence';
import { assertTestOrigin } from '../support/origin-guard';

// The dev server (vite --mode e2e) doesn't build or serve a service worker;
// this spec needs the preview build's real /sw.js.
test.skip(process.env.E2E_SERVER === 'dev', 'needs the preview build');

// STOP condition from the issue: context.route('**/sw.js', ...) does not
// intercept the browser's own service-worker update-check fetch in Chromium.
// Confirmed with a diagnostic: registration.update() makes two real GET
// /sw.js requests (visible to context.on('request')), but the registered
// route handler is never invoked for either — the update check runs against
// the real, unchanged file, so no update is ever detected and the prompt
// never appears. Reported for a decision (the fallback is building the app
// twice, which needs a call on the added wall time):
// https://github.com/2002Bishwajeet/journal/issues/199#issuecomment-5858793097
test('a changed service worker surfaces the update prompt and reloads on accept @quarantine', async ({ browser }) => {
  test.fixme(true, 'https://github.com/2002Bishwajeet/journal/issues/199#issuecomment-5858793097');

  // The hermetic project blocks service workers by default (sw.ts's own
  // fetches can bypass context.route()'s network fence — see
  // playwright.config.ts). This one spec needs a real, activated SW, so it
  // opens its own context with them explicitly allowed; sw.ts only ever
  // registers same-origin routes (checked: static assets, /api/, navigation
  // fallback), so this doesn't reopen the fence-bypass risk that default
  // block is guarding against.
  const context = await browser.newContext({
    storageState: 'e2e/fixtures/hermetic-auth.json',
    serviceWorkers: 'allow',
  });
  const { violations } = await installNetworkFence(context);
  const app = await context.newPage();

  try {
    await app.goto('/');
    await assertTestOrigin(app);
    await waitForAppReady(app);

    await app.waitForFunction(() => navigator.serviceWorker.controller !== null);

    const originalBody = await app.evaluate(() => fetch('/sw.js').then((r) => r.text()));

    await context.route('**/sw.js', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `${originalBody}\n// e2e-bump`,
      }),
    );

    await app.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });

    const updateToast = app.getByText('New version available');
    await expect(updateToast).toBeVisible();

    const reloaded = app.waitForEvent('load');
    await app.getByRole('button', { name: 'Update' }).click();
    await reloaded;

    await waitForAppReady(app);
    await expect(updateToast).toBeHidden();
  } finally {
    await context.close();
  }
  assertNoFenceViolations(violations);
});
