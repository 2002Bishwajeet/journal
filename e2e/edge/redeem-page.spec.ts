import { expect, test, type Page } from '@playwright/test';

// #1464: the invite redeem page on the hermetic edge server, with the billing Worker mocked.
// Screenshots of the invite, the key and an invalid link at 1280 and 390, light and dark.
// Reduced motion keeps the entrance reveals from hiding parts of a full-page shot.
const viewports = { desktop: { width: 1280, height: 800 }, phone: { width: 390, height: 844 } };
const CODE = 'K7Q2-9XMA-ALEX';
const KEY = 'JRNL-7F3K-Q9WD-2MXA-LIFE';

/** The Worker's answer to POST /invite/redeem, with CORS as the real one sends it for the site's origin. */
async function worker(page: Page, status: number, body: object) {
  await page.route('**/invite/redeem', (route) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ status, headers, json: body });
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const [name, size] of Object.entries(viewports)) {
    test.describe(`redeem page ${theme} ${name}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.setViewportSize(size);
      });

      test('invite, then the key', async ({ page }) => {
        await worker(page, 200, { licenseKey: KEY });
        await page.goto(`/landing/redeem?code=${CODE}`);
        await expect(page.locator('body[data-page="redeem"]')).toBeVisible();
        await expect(page).toHaveURL(/\/landing\/redeem$/);
        await expect(page.locator('#redeem-code-masked')).toHaveText('K7Q2-••••-••••');
        await expect(page.locator('#redeem-code-input')).toBeHidden();
        await page.screenshot({ path: test.info().outputPath(`redeem-invite-${theme}-${name}.png`), fullPage: true });

        await page.getByRole('button', { name: 'Get my key' }).click();
        await expect(page.locator('#redeem-key')).toHaveText(KEY);
        await expect(page.getByText("Save this key now. It's only shown once.")).toBeVisible();
        await expect(page.getByRole('link', { name: 'Download the Journal app' })).toHaveAttribute('href', '/landing/download');
        await page.screenshot({ path: test.info().outputPath(`redeem-success-${theme}-${name}.png`), fullPage: true });
      });

      test('an invite that is no longer valid', async ({ page }) => {
        await worker(page, 404, { error: 'invite_not_valid' });
        await page.goto(`/landing/redeem?code=${CODE}`);
        await page.getByRole('button', { name: 'Get my key' }).click();
        await expect(page.getByRole('alert')).toContainText("This invite link isn't valid any more.");
        await expect(page.locator('body')).not.toContainText(CODE);
        await page.screenshot({ path: test.info().outputPath(`redeem-invalid-${theme}-${name}.png`), fullPage: true });
      });
    });
  }
}

test('without a code in the link, the code field shows', async ({ page }) => {
  await page.goto('/landing/redeem');
  await expect(page.getByLabel('Invite code')).toBeVisible();
  await expect(page.getByLabel(/Email/)).toBeVisible();
});

test('the page is kept out of referrers, caches and search', async ({ page }) => {
  const res = await page.goto(`/landing/redeem?code=${CODE}`);
  const headers = res!.headers();
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['cache-control']).toContain('no-store');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});
