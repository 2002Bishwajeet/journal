import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { screenshotInBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import type { Page } from '@playwright/test';

const PHONE = { width: 393, height: 852 };
const AUTH = 'e2e/fixtures/hermetic-auth.json';

async function openSettings(page: Page, tablet = false) {
  await page.goto('/');
  await assertTestOrigin(page);
  await waitForAppReady(page);
  if (tablet) await page.getByRole('button', { name: 'Show folders', exact: true }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Wait for the open animation to finish so boxes are final.
  await expect
    .poll(() => dialog.evaluate((el) => el.getAnimations({ subtree: true }).length === 0 && getComputedStyle(el).opacity === '1'))
    .toBe(true);
  return dialog;
}

test('phone: Settings is a full-screen sheet with a tab strip that keeps tabs whole', async ({ browser }) => {
  await withFencedPage(browser, { storageState: AUTH, viewport: PHONE, hasTouch: true, isMobile: true }, async (page) => {
    const dialog = await openSettings(page);

    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - PHONE.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - PHONE.height)).toBeLessThanOrEqual(1);

    const tablist = dialog.getByRole('tablist');
    const tabs = dialog.getByRole('tab');

    // First tab lines up with the title.
    const titleBox = (await dialog.getByRole('heading', { name: 'Settings', exact: true }).boundingBox())!;
    const firstBox = (await tabs.first().boundingBox())!;
    expect(Math.abs(firstBox.x - titleBox.x)).toBeLessThanOrEqual(2);

    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      const tab = tabs.nth(i);
      const name = (await tab.textContent())!.trim();
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      // Selecting scrolls the tab fully into view.
      await expect
        .poll(async () => {
          const t = (await tab.boundingBox())!;
          const l = (await tablist.boundingBox())!;
          return t.x >= l.x - 1 && t.x + t.width <= l.x + l.width + 1;
        })
        .toBe(true);

      // The section heading is not repeated visibly under the tab.
      const h2 = dialog.getByRole('tabpanel').getByRole('heading', { level: 2, name, exact: true });
      if (await h2.count()) {
        const hb = await h2.first().boundingBox();
        expect(hb === null || hb.width <= 1 || hb.height <= 1).toBe(true);
      }

      await screenshotInBothThemes(page, (theme) => `settings-${i}-${theme}-393.png`);
    }
  });
});

test('tablet 800px: the dialog keeps a 16px margin', async ({ browser }) => {
  await withFencedPage(browser, { storageState: AUTH, viewport: { width: 800, height: 1024 } }, async (page) => {
    // A tablet keeps the folders (and Settings) in an overlay opened from the list header (#832).
    const dialog = await openSettings(page, true);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16 - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(800 - 16 + 1);
    await page.screenshot({ path: test.info().outputPath('settings-800.png') });
  });
});

test('narrow tablet 700px: still a full-screen sheet', async ({ browser }) => {
  await withFencedPage(browser, { storageState: AUTH, viewport: { width: 700, height: 900 } }, async (page) => {
    const dialog = await openSettings(page);
    const box = (await dialog.boundingBox())!;
    expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - 700)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 900)).toBeLessThanOrEqual(1);
  });
});

test('desktop 1280px: screenshot for comparison', async ({ browser }) => {
  await withFencedPage(browser, { storageState: AUTH, viewport: { width: 1280, height: 800 } }, async (page) => {
    await openSettings(page);
    await page.screenshot({ path: test.info().outputPath('settings-1280.png') });
  });
});
