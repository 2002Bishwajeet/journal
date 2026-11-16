import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #1282: a device no identity signed in on opens the sign-in page on a welcome step (what
// Journal is, why Homebase, Create your Homebase identity, I have an identity); a device that
// signed in before goes straight to the identity form. The web never states the trial.

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

/**
 * One screenshot per theme. Signed out, the page takes the theme when it loads (only the signed-in
 * layout follows a later change), so each theme loads it again; `reopen` gets back to the state.
 */
async function shootBothThemes(page: Page, name: (theme: string) => string, reopen?: () => Promise<void>) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    // The class is set before the app draws: wait for the step's heading.
    await expect(page.locator('h2')).toBeVisible();
    await reopen?.();
    // The step's fade-in has ended, so the screenshot shows it settled.
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
    await page.screenshot({ path: test.info().outputPath(name(theme)) });
  }
}

test('signed-out root redirects to /welcome and opens on the welcome step', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Welcome to Journal' })).toBeVisible();
});

for (const [viewport, size] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
  test(`${viewport}: a first visit shows the welcome step; I have an identity shows the form with focus in the field`, async ({ browser }) => {
    await withFencedPage(browser, { viewport: size, hasTouch: viewport === 'phone' }, async (page) => {
      await page.context().route('https://homebase.id/**', (route) => route.fulfill({ body: 'Homebase sign-up' }));
      await page.goto('/welcome');
      await assertTestOrigin(page);

      await expect(page.getByRole('heading', { name: 'Welcome to Journal' })).toBeVisible();
      await expect(page.getByText('Your notes live on your own Homebase, encrypted.')).toBeVisible();
      await expect(page.getByText('Homebase sign-up is in closed beta')).toBeVisible();
      // The web app is free: no trial, no price.
      await expect(page.getByText(/Free for 3 days|one-time unlock/)).toHaveCount(0);
      await expect(page.getByLabel('Identity')).toHaveCount(0);
      // The desktop panel keeps the pre-#1282 design (#1303).
      if (viewport === 'desktop') {
        await expect(page.getByRole('heading', { name: 'Capture your thoughts with clarity and calm.' })).toBeVisible();
      }
      // Everything fits the first screen, and the buttons are tap-sized.
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(size.height);
      const create = page.getByRole('link', { name: 'Create your Homebase identity' });
      const have = page.getByRole('button', { name: 'I have an identity' });
      for (const control of [create, have]) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);

      // On the web the sign-up page opens in a new tab.
      const [signUp] = await Promise.all([page.waitForEvent('popup'), create.click()]);
      await expect(signUp).toHaveURL('https://homebase.id/');
      await signUp.close();

      await have.click();
      const identity = page.getByLabel('Identity');
      await expect(identity).toBeFocused();
      // Not a return yet, so not "Welcome back".
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toHaveCount(0);

      await shootBothThemes(page, (theme) => `welcome-${theme}-${viewport}.png`);
      await shootBothThemes(page, (theme) => `sign-in-${theme}-${viewport}.png`, () => have.click());
    });
  });
}

test('a device that signed in before skips the welcome step, also after sign-out', async ({ browser }) => {
  await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json', viewport: PHONE }, async (page) => {
    await page.goto('/');
    await assertTestOrigin(page);
    await waitForAppReady(page);
    // Signed out as sign-out leaves the device: the session keys go, the rest stays.
    await page.evaluate(() => ['APSS', 'BX0900', 'identity'].forEach((key) => localStorage.removeItem(key)));
    await page.goto('/welcome');

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByLabel('Identity')).toBeFocused();
    await expect(page.getByRole('button', { name: 'I have an identity' })).toHaveCount(0);
    await shootBothThemes(page, (theme) => `welcome-back-${theme}-phone.png`);
  });
});

// #1303: the pre-#1282 design is back. Shots of the first-run welcome step and the returning
// device's sign-in at 1440 and 390 px, to set beside the old page.
for (const [viewport, size] of [['1440', { width: 1440, height: 900 }], ['390', PHONE]] as const) {
  test(`${viewport} px: the welcome step and the returning sign-in keep the old design`, async ({ browser }) => {
    await withFencedPage(browser, { viewport: size }, async (page) => {
      await page.goto('/welcome');
      await assertTestOrigin(page);
      await expect(page.getByRole('heading', { name: 'Welcome to Journal' })).toBeVisible();
      if (viewport === '1440') {
        await expect(page.getByText('A minimalist space for your intellectual journey.')).toBeVisible();
      }
      await shootBothThemes(page, (theme) => `first-run-welcome-${theme}-${viewport}.png`);
    });
    await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json', viewport: size }, async (page) => {
      await page.goto('/');
      await assertTestOrigin(page);
      await waitForAppReady(page);
      await page.evaluate(() => ['APSS', 'BX0900', 'identity'].forEach((key) => localStorage.removeItem(key)));
      await page.goto('/welcome');
      await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
      await shootBothThemes(page, (theme) => `returning-sign-in-${theme}-${viewport}.png`);
    });
  });
}

test('a failed sign-in opens on the form with its error', async ({ page }) => {
  await page.goto('/welcome?error=auth_failed');
  await expect(page.getByText('Sign-in failed. Please try again.')).toBeVisible();
  await expect(page.getByLabel('Identity')).toBeFocused();
});
