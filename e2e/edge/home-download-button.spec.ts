import { test, expect } from '../fixtures';

// #1473: the home page's download button fits the visitor's OS, as the deploy serves it (downloads on, App Store
// on, Google Play off). Each platform at desktop and phone width, saved for the PR.

const RELEASE = 'https://github.com/2002Bishwajeet/journal/releases/latest/download/';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

const CASES = [
  { name: 'mac', userAgent: MAC, label: 'Download for Mac', href: `${RELEASE}Journal-darwin-universal.dmg` },
  { name: 'windows', userAgent: WINDOWS, label: 'Download for Windows', href: `${RELEASE}Journal-windows-x64-setup.exe` },
  { name: 'linux', userAgent: LINUX, label: 'Download for Linux', href: `${RELEASE}Journal-linux-amd64.AppImage` },
  { name: 'android', userAgent: ANDROID, label: 'All downloads', href: '/landing/download' },
];
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
];

for (const viewport of VIEWPORTS) {
  for (const { name, userAgent, label, href } of CASES) {
    test.describe(`${name}, ${viewport.name}`, () => {
      test.use({ userAgent });

      test('the hero button names the platform and links its installer', async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/');
        const button = page.locator('.hero-actions a[data-download]');
        await expect(button).toHaveText(label);
        await expect(button).toHaveAttribute('href', href);
        // "Other platforms" appears only once the button goes to one installer.
        if (name === 'android') await expect(page.locator('.hero-other')).toBeHidden();
        else await expect(page.getByRole('link', { name: 'Other platforms' })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Open Journal' }).first()).toBeVisible();
        await page.screenshot({ path: test.info().outputPath(`home-download-${name}-${viewport.name}.png`) });
      });
    });
  }

  test.describe(`iphone, ${viewport.name}`, () => {
    test.use({ userAgent: IPHONE });

    test('the App Store badge stands in for the button', async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.locator('.hero-actions a[data-download]')).toBeHidden();
      await expect(page.locator('.hero-actions .store-badge')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`home-download-iphone-${viewport.name}.png`) });
    });
  });
}
