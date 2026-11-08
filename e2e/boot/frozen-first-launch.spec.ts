import { devices, type Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// Android Chrome freezes an app left in the background. A frozen database worker
// keeps PGlite's election lock, so the next launch waited on it forever (#1006).
// The app now stops its worker on `freeze` and reloads on `resume`.
//
// CDP's Page.setWebLifecycleState freezes the page but fires neither event in
// Playwright's Chromium, so the test dispatches them itself, as Chrome does
// just before it freezes a page and just after it thaws one.

const { defaultBrowserType: _browser, ...pixel } = devices['Pixel 7'];
test.use({ ...pixel, storageState: 'e2e/fixtures/hermetic-auth.json' });
test.setTimeout(90_000);

const booted = (page: Page, timeout: number) =>
  page.waitForFunction(() => performance.getEntriesByName('journal-boot:ui').length > 0, null, { timeout });

const dbWorkers = (page: Page) => page.workers().filter((worker) => worker.url().includes('pglite-worker'));

test('a second launch opens while the first one is frozen', async ({ context }) => {
  const first = await context.newPage();
  await first.goto('/');
  await assertTestOrigin(first);
  await booted(first, 60_000);
  expect(dbWorkers(first)).toHaveLength(1);

  await first.evaluate(() => document.dispatchEvent(new Event('freeze')));
  const cdp = await context.newCDPSession(first);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await expect.poll(() => dbWorkers(first).length).toBe(0);

  // The second launch gets the lock: its own worker becomes the leader.
  const second = await context.newPage();
  await second.goto('/');
  await booted(second, 8_000);
  expect(await second.evaluate(() => performance.getEntriesByName('journal-boot:db-leader').length)).toBeGreaterThan(0);

  // Resumed, the first launch has no database, so it loads again and boots.
  const reloaded = first.waitForEvent('load');
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  // In a timer, so the reload doesn't destroy this evaluate's context mid-call.
  await first.evaluate(() => void setTimeout(() => document.dispatchEvent(new Event('resume'))));
  await reloaded;
  await booted(first, 30_000);
});
