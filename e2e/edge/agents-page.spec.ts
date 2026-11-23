import { test, expect } from '../fixtures';

// #1454: the agents page's install card, as a non-technical Claude user meets it. Claude Desktop opens
// first, the address field fills every command, a command stays on one line on a phone, and the page
// is saved at 1280 and 390, light and dark, for the PR.

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
];

test('the agents page install card, at 1280 and 390, light and dark', async ({ page }) => {
  await page.goto('/landing/agents');
  await expect(page.getByRole('heading', { name: 'Which Claude do you use?' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Claude Desktop' })).toHaveAttribute('aria-selected', 'true');

  const address = page.getByLabel('Your Homebase address');
  await address.fill('alex.dotyou.cloud');
  await expect(page.locator('#install-desktop-login')).toHaveText('npx -y journal-mcp@latest login alex.dotyou.cloud');
  await expect(page.locator('.identity')).toHaveText(Array(7).fill('alex.dotyou.cloud'));
  await address.fill('');
  await expect(page.locator('#install-desktop-login')).toHaveText('npx -y journal-mcp@latest login type.your.identity.here');

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    // One line per command: the sign-in command's box is one line tall, and scrolls sideways when it must.
    const login = page.locator('#install-desktop-login');
    const lineHeight = await login.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect((await login.boundingBox())!.height).toBeLessThan(lineHeight * 1.5);

    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => document.querySelectorAll('img').forEach((img) => (img.loading = 'eager')));
      // Scroll through once, so every entrance reveal (data-reveal) has run, then back to the top.
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await expect(page.locator('[data-reveal]:not(.in)')).toHaveCount(0);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: test.info().outputPath(`agents-${colorScheme}-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
      await page.locator('#setup .setup-step').first().screenshot({ path: test.info().outputPath(`agents-install-${colorScheme}-${viewport.name}.png`), animations: 'disabled' });
    }
  }
});
