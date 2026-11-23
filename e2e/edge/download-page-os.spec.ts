import { test, expect } from '../fixtures';

// #1475: the download page shows the visitor's OS as the one download, the other two under "Other platforms".
// Each OS at desktop and phone width, light and dark, saved for the PR.

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

const CASES = [
  { name: 'mac', userAgent: MAC, shown: 'Download for Mac', other: ['Windows', 'Linux'] },
  { name: 'windows', userAgent: WINDOWS, shown: 'Download for Windows', other: ['Mac', 'Linux'] },
  { name: 'linux', userAgent: LINUX, shown: 'Download AppImage', other: ['Mac', 'Windows'] },
];
const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800 },
  { name: '390', width: 390, height: 844 },
];
const THEMES = ['light', 'dark'] as const;

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    for (const { name, userAgent, shown, other } of CASES) {
      test.describe(`${name}, ${theme}, ${viewport.name}`, () => {
        test.use({ userAgent });

        test('one download, the others under Other platforms', async ({ page }) => {
          await page.setViewportSize(viewport);
          await page.emulateMedia({ colorScheme: theme });
          await page.goto('/landing/download');
          const panel = page.locator('.dl-panel');
          await expect(panel.locator('> .dl-list .dl-item')).toHaveCount(1);
          await expect(panel.locator('> .dl-list .btn-primary')).toHaveText(shown);
          const details = panel.locator('details.dl-other');
          await expect(details.locator('.dl-item')).toHaveCount(2);
          await expect(details.locator('.dl-item:visible')).toHaveCount(0);
          await page.screenshot({ path: test.info().outputPath(`download-${name}-${theme}-${viewport.name}-closed.png`) });
          await details.locator('summary').click();
          for (const o of other) await expect(details.getByRole('heading', { name: o })).toBeVisible();
          await page.screenshot({ path: test.info().outputPath(`download-${name}-${theme}-${viewport.name}-open.png`) });
        });
      });
    }
  }
}

test.describe('android', () => {
  test.use({ userAgent: ANDROID });

  test('keeps the plain list of all three', async ({ page }) => {
    await page.goto('/landing/download');
    await expect(page.locator('.dl-item')).toHaveCount(3);
    await expect(page.locator('details.dl-other')).toHaveCount(0);
  });
});
