import { test, expect } from '../fixtures';

// #1454: the agents page's install card, as a non-technical Claude user meets it. Claude Desktop opens
// first, the address field fills every command, a command stays on one line on a phone, and the page
// is saved at 1280 and 390, light and dark, for the PR. #1457: the Claude Desktop tab leads with the
// extension's download and three steps; its terminal route folds away under them. #1512: after the four steps,
// the hosted server's address to add as a remote MCP server, with its own Copy button.

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '390', width: 390, height: 844 },
];

test('the agents page install card, at 1280 and 390, light and dark', async ({ page }) => {
  await page.goto('/landing/agents');
  await expect(page.getByRole('heading', { name: 'Which Claude do you use?' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Claude Desktop' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: 'Download for Claude Desktop' })).toBeVisible();
  await expect(page.locator('#panel-desktop > ol.cmds > li')).toHaveCount(3);
  await expect(page.locator('#install-desktop-login')).toBeHidden();

  const address = page.getByLabel('Your Homebase address');
  await address.fill('alex.dotyou.cloud');
  await expect(page.locator('#install-desktop-login')).toHaveText('npx -y journal-mcp@latest login alex.dotyou.cloud');
  await expect(page.locator('.identity')).toHaveText(Array(8).fill('alex.dotyou.cloud'));
  await address.fill('');
  await expect(page.locator('#install-desktop-login')).toHaveText('npx -y journal-mcp@latest login type.your.identity.here');
  await expect(page.locator('#online-url')).toHaveText('https://mcp.cloudx.run/journal');
  await expect(page.getByRole('button', { name: 'Copy the server address' })).toBeVisible();

  const terminal = page.locator('#panel-desktop details.alt-setup');
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: 'light' });
    // One line per command: the sign-in command's box is one line tall, and scrolls sideways when it must.
    await terminal.locator('summary').click();
    const login = page.locator('#install-desktop-login');
    await expect(login).toBeVisible();
    const lineHeight = await login.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    expect((await login.boundingBox())!.height).toBeLessThan(lineHeight * 1.5);
    await page.locator('#setup .setup-step').first().screenshot({ path: test.info().outputPath(`agents-install-terminal-light-${viewport.name}.png`), animations: 'disabled' });
    await terminal.locator('summary').click();
    await expect(login).toBeHidden();

    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.evaluate(() => document.querySelectorAll('img').forEach((img) => (img.loading = 'eager')));
      // Scroll through once, so every entrance reveal (data-reveal) has run, then back to the top. Again until they
      // have: the page can still grow under the first jump and leave the closing section below the fold.
      await expect(async () => {
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
        await expect(page.locator('[data-reveal]:not(.in)')).toHaveCount(0, { timeout: 1000 });
      }).toPass();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: test.info().outputPath(`agents-${colorScheme}-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
      await page.locator('#setup .setup-step').first().screenshot({ path: test.info().outputPath(`agents-install-${colorScheme}-${viewport.name}.png`), animations: 'disabled' });
      await page.locator('#online').screenshot({ path: test.info().outputPath(`agents-online-${colorScheme}-${viewport.name}.png`), animations: 'disabled' });
    }
  }
});
