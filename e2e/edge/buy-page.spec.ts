import { expect, test } from '@playwright/test';

// Screenshots of the buy page for the #1302 review, taken on the hermetic edge server, whose landing
// build has billing on (playwright.config.ts). Reduced motion keeps the scroll-in reveals from hiding
// the sections below the fold in a full-page shot.
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

for (const theme of ['light', 'dark'] as const) {
  for (const [name, size] of Object.entries(viewports)) {
    test(`buy page ${theme} ${name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.setViewportSize(size);
      await page.goto('/landing/buy');
      await expect(page.locator('body[data-page="buy"]')).toBeVisible();
      await expect(page.locator('#buy-new'), 'the landing build needs VITE_BILLING_LIVE=true').toBeVisible();
      await expect(page.locator('#renew-form')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(/Dodo|EARLYBIRD/i);
      await page.screenshot({ path: test.info().outputPath(`buy-${theme}-${name}.png`), fullPage: true });
    });
  }
}
