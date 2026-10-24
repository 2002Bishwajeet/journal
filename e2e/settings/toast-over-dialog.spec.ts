import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { inBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import type { Page } from '@playwright/test';

// A toast shown over an open dialog stays tappable and doesn't dismiss the dialog (#786).

async function showToastOverSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'About', exact: true }).click();
  await dialog.getByRole('button', { name: 'Copy' }).click();
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast).toBeVisible();
  return { dialog, toast };
}

test('mobile: tapping a toast keeps Settings open and the toast clears the safe area', async ({ browser }) => {
  await withFencedPage(
    browser,
    { storageState: 'e2e/fixtures/hermetic-auth.json', viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true, permissions: ['clipboard-read', 'clipboard-write'] },
    async (page) => {
      // iPhone 15 notch and home indicator (Chromium only).
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34 } });
      await page.goto('/');
      await assertTestOrigin(page);
      await waitForAppReady(page);
      const { dialog, toast } = await showToastOverSettings(page);
      await expect(page.locator('[data-sonner-toaster]')).not.toHaveCSS('pointer-events', 'none');
      await expect(toast).not.toHaveCSS('pointer-events', 'none');
      await expect.poll(async () => {
        const b = (await toast.boundingBox())!;
        return b.y + b.height;
      }).toBeLessThanOrEqual(852 - 34);
      await inBothThemes(page, async (theme) => {
        await page.screenshot({ path: test.info().outputPath(`toast-${theme}-393.png`) });
      });
      const box = (await toast.boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(300);
      await expect(dialog).toBeVisible();
    },
  );
});

test('desktop: clicking a toast keeps Settings open; the overlay still closes it', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  const { dialog, toast } = await showToastOverSettings(app);
  await toast.click();
  await app.waitForTimeout(300);
  await expect(dialog).toBeVisible();

  await app.mouse.click(5, 5);
  await expect(dialog).toBeHidden();
});
