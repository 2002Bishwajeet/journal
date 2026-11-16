import { expect, test } from '@playwright/test';

// Screenshots of the buy page for the #1302 review, taken on the hermetic edge server.
// Build the landing site with VITE_BILLING_LIVE=true to capture the live checkout state.
const viewports = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };

for (const theme of ['light', 'dark'] as const) {
  for (const [name, size] of Object.entries(viewports)) {
    test(`buy page ${theme} ${name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize(size);
      await page.goto('/landing/buy');
      await expect(page.locator('body[data-page="buy"]')).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Dodo');
      await page.screenshot({ path: test.info().outputPath(`buy-${theme}-${name}.png`), fullPage: true });
    });
  }
}
