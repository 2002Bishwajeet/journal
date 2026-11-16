import { existsSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #1282: the store build's welcome step states the trial with the store's localized price. The
// app is forced native through the init-script globals, as in e2e/native/paywall.spec.ts.

const PRICE = '24,99 €';
const PHONE = { width: 390, height: 844 };

test.skip(!existsSync('native/web/index.ts'), 'needs the private native/ module');

test('ios store build: the welcome step states the trial with the store price', async ({ browser }) => {
  await withFencedPage(browser, { viewport: PHONE, hasTouch: true }, async (page: Page) => {
    const calls: string[] = [];
    await page.exposeFunction('deviceIpc', (cmd: string) => {
      calls.push(cmd);
      if (cmd === 'plugin:journal-iap|products') return [{ id: 'journal.unlock', displayName: 'Journal', displayPrice: PRICE }];
      return null;
    });
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__JOURNAL_NATIVE__ = { platform: 'ios', plugins: ['journal-iap'] };
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => 0,
        invoke: (cmd: string, args: Record<string, unknown> = {}) =>
          (w.deviceIpc as (cmd: string, args: unknown) => Promise<unknown>)(cmd, args),
      };
    });
    await page.goto('/welcome');
    await assertTestOrigin(page);

    await expect(page.getByRole('heading', { name: 'Welcome to Journal+' })).toBeVisible();
    await expect(page.getByText(`Free for 3 days, then a one-time unlock for ${PRICE}.`)).toBeVisible();
    // Signed out: it asks the store for the price only, and starts no trial clock.
    expect(calls.filter((cmd) => cmd.startsWith('plugin:journal-'))).toEqual(['plugin:journal-iap|products']);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(PHONE.height);
    // Signed out, the page takes the theme when it loads, so each theme loads it again.
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.reload();
      await expect(page.locator('html')).toHaveClass(new RegExp(theme));
      await expect(page.getByText(`Free for 3 days, then a one-time unlock for ${PRICE}.`)).toBeVisible();
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
      await page.screenshot({ path: test.info().outputPath(`welcome-store-${theme}-phone.png`) });
    }
  });
});
