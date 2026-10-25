import type { Locator, Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #785: text fields are 16 px on touch screens (so focusing one never zooms the
// page), the sign-in screen fits the visible screen, and the viewport is not locked.

const PHONE = { width: 393, height: 852 };
const IPAD = { width: 834, height: 1194 };
const DESKTOP = { width: 1280, height: 800 };
const AUTH = 'e2e/fixtures/hermetic-auth.json';

const fontSize = (el: Locator) => el.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));

async function expectAllAtLeast16(els: Locator) {
  await expect(els.first()).toBeVisible();
  for (const el of await els.all()) expect(await fontSize(el)).toBeGreaterThanOrEqual(16);
}

async function openSignedIn(page: Page) {
  await page.goto('/');
  await assertTestOrigin(page);
  await waitForAppReady(page);
}

// The hermetic drive answers nothing for the grants file, so Agent access would never
// load; answer "no grants file yet" like e2e/ai/webmcp.spec.ts does.
async function mockNoGrantsFile(page: Page) {
  await page.route('**/drive/query/specialized/cuid/header**', (route) => {
    const origin = route.request().headers()['origin'] ?? '*';
    return route.fulfill({
      status: route.request().method() === 'OPTIONS' ? 204 : 404,
      headers: {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': '*',
      },
    });
  });
}

test('index.html has one viewport meta without a zoom lock', async ({ anonPage: page }) => {
  await page.goto('/welcome');
  const metas = page.locator('meta[name="viewport"]');
  await expect(metas).toHaveCount(1);
  const content = (await metas.getAttribute('content')) ?? '';
  expect(content).not.toMatch(/maximum-scale|user-scalable/);
});

test('phone: sign-in fits the screen, field is 16 px, link is 44 px tall', async ({ browser }) => {
  await withFencedPage(browser, { viewport: PHONE, hasTouch: true, isMobile: true }, async (page) => {
    await page.goto('/welcome');
    await assertTestOrigin(page);
    const identity = page.getByLabel('Identity');
    await expect(identity).toBeVisible();
    expect(await fontSize(identity)).toBeGreaterThanOrEqual(16);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(PHONE.height);
    const link = page.getByRole('link', { name: 'Create an identity' });
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test('iPad: sign-in field is 16 px', async ({ browser }) => {
  await withFencedPage(browser, { viewport: IPAD, hasTouch: true, isMobile: true }, async (page) => {
    await page.goto('/welcome');
    await assertTestOrigin(page);
    const identity = page.getByLabel('Identity');
    await expect(identity).toBeVisible();
    expect(await fontSize(identity)).toBeGreaterThanOrEqual(16);
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`phone: sign-in error state reads in ${colorScheme}`, async ({ browser }, testInfo) => {
    await withFencedPage(browser, { viewport: PHONE, hasTouch: true, isMobile: true, colorScheme }, async (page) => {
      await page.goto('/welcome');
      await assertTestOrigin(page);
      await page.getByLabel('Identity').fill('not a valid identity');
      await page.getByRole('button', { name: 'Continue' }).tap();
      await expect(page.locator('.text-destructive')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`signin-error-${colorScheme}-phone.png`) });
    });
  });
}

test('phone: Settings > Agent access selects and the New folder field are 16 px', async ({ browser }, testInfo) => {
  await withFencedPage(browser, { storageState: AUTH, viewport: PHONE, hasTouch: true, isMobile: true }, async (page) => {
    await openSignedIn(page);
    await mockNoGrantsFile(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Agent access' }).click();
    await expectAllAtLeast16(dialog.locator('select'));
    await page.screenshot({ path: testInfo.outputPath('agent-access-light-phone.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New folder' }).tap();
    const folderName = page.getByPlaceholder('Folder Name');
    await expect(folderName).toBeVisible();
    expect(await fontSize(folderName)).toBeGreaterThanOrEqual(16);
  });
});

test('desktop: inputs keep 14 px', async ({ browser }, testInfo) => {
  await withFencedPage(browser, { viewport: DESKTOP }, async (page) => {
    await page.goto('/welcome');
    await assertTestOrigin(page);
    expect(await fontSize(page.getByLabel('Identity'))).toBe(14);
    await page.screenshot({ path: testInfo.outputPath('signin-light-desktop.png') });
  });
  await withFencedPage(browser, { storageState: AUTH, viewport: DESKTOP }, async (page) => {
    await openSignedIn(page);
    await mockNoGrantsFile(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Agent access' }).click();
    await expect(dialog.getByLabel('Agent access for Main')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('agent-access-light-desktop.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New folder' }).click();
    expect(await fontSize(page.getByPlaceholder('Folder Name'))).toBe(14);
  });
});
