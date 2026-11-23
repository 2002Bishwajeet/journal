import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// #1294: the landing site's launch pages, as the deploy serves them: the App Store badge on, Google Play off (#1455).
// Each page at desktop and phone width, in light and dark, saved for the PR.

const PAGES = [
  { name: 'home', path: '/', badges: true },
  { name: 'download', path: '/landing/download', badges: true },
  { name: 'pricing', path: '/landing/pricing', badges: false },
  { name: 'buy', path: '/landing/buy', badges: true },
];
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
];

// Every picture loaded, so a full-page screenshot shows the lazy ones below the fold too.
async function loadAllPictures(page: Page) {
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll('img')];
    for (const img of images) img.loading = 'eager';
    await Promise.all(images.map((img) => (img.complete ? null : new Promise((done) => { img.onload = img.onerror = done; }))));
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of VIEWPORTS) {
    test(`launch pages, ${colorScheme}, ${viewport.name}`, async ({ page }) => {
      // Default motion, as most visitors see it: reduced motion would give the hero video its player controls.
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize(viewport);
      for (const { name, path, badges } of PAGES) {
        await page.goto(path);
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('.store-badges')).toHaveCount(badges ? 1 : 0);
        await expect(page.locator('a[href*="play.google.com"]')).toHaveCount(0);
        await expect(page.locator('header.nav a[href="/landing/download"]')).toHaveCount(2); // the bar and the phone menu
        await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Download', exact: true })).toBeVisible();
        await expect(page.locator('body')).not.toContainText(/coming soon|TestFlight/i);
        if (badges) {
          const badge = page.getByRole('link', { name: 'Download on the App Store' });
          await badge.scrollIntoViewIfNeeded();
          await expect(badge).toBeVisible();
          expect((await badge.boundingBox())!.height).toBeGreaterThanOrEqual(40);
          await expect(page.locator('.store-badges').getByText('Android: coming later')).toBeVisible();
        }
        await loadAllPictures(page);
        // Scroll through once, so every entrance reveal (data-reveal) has run, then back to the top.
        await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
        await expect(page.locator('[data-reveal]:not(.in)')).toHaveCount(0);
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await expect(page.locator('.hero-video[controls]')).toHaveCount(0);
        await page.screenshot({ path: test.info().outputPath(`${name}-${colorScheme}-${viewport.name}.png`), fullPage: true, animations: 'disabled' });
      }
    });
  }
}

// #1456: the download page's "What the apps add" section, saved on its own for the PR.
for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of VIEWPORTS) {
    test(`download page, what the apps add, ${colorScheme}, ${viewport.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize(viewport);
      await page.goto('/landing/download');
      const section = page.locator('#apps-add');
      // Scroll past the whole section once, so every entrance reveal in it has run.
      await section.locator('.adds-close').scrollIntoViewIfNeeded();
      await section.scrollIntoViewIfNeeded();
      await expect(section.getByRole('heading', { level: 2, name: 'What the apps add' })).toBeVisible();
      await expect(section.getByRole('heading', { level: 3 })).toHaveCount(6);
      await expect(section.getByText('Everything else is the same Journal you use in the browser, which stays free.')).toBeVisible();
      await expect(section.locator('[data-reveal]:not(.in)')).toHaveCount(0);
      // Two items to a row on a desktop, one on a phone (offsetTop ignores the entrance transform).
      const [first, second] = await section.locator('.adds > li').evaluateAll((items) => items.map((li) => (li as HTMLElement).offsetTop));
      if (viewport.width >= 760) expect(second).toBe(first);
      else expect(second).toBeGreaterThan(first);
      await section.screenshot({ path: test.info().outputPath(`download-apps-add-${colorScheme}-${viewport.width}.png`), animations: 'disabled' });
    });
  }
}

// The device frames are pictures flattened by scripts/device-frames.ts: the one shown must have loaded.
async function expectLoaded(page: Page, selector: string) {
  const picture = page.locator(selector);
  await expect(picture).toBeVisible();
  await picture.scrollIntoViewIfNeeded();
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
}

test('the home hero leads with privacy, its phone in the iPhone frame', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Private notes, encrypted.');
  await expectLoaded(page, '.hero-phone img[src$="/media/phone-live-block-iphone-light.webp"]');
  await expect(page.locator('.frame-hero')).toBeHidden(); // no desktop window squeezed onto a phone
  expect(await page.locator('main .window:visible, main .device:visible').count()).toBeLessThanOrEqual(3);
});

test('the home desktop pictures sit in a macOS window, the phone in front of it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('.window.frame-hero video.only-dark')).toHaveAttribute('poster', /\/media\/hero-poster-dark\.webp$/);
  await expectLoaded(page, '.hero-phone img[src$="/media/phone-live-block-iphone-dark.webp"]');
  await expectLoaded(page, '.window.share-page img[src$="/media/public-page-dark.webp"]');
  // The window draws its title bar above the capture: the traffic lights sit in the window's top padding.
  const bar = await page.locator('.window.share-page').evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  expect(bar).toBeGreaterThan(20);
  // Three framed screenshots on the home page at most (owner, 2026-11-16).
  expect(await page.locator('main .window:visible, main .device:visible').count()).toBeLessThanOrEqual(3);
});

test('the download page shows the two after-install steps', async ({ page }) => {
  await page.goto('/landing/download');
  const section = page.getByRole('heading', { name: 'After you install' }).locator('xpath=ancestor::section');
  await expect(section.locator('.step-title')).toHaveText(['Create a Homebase identity', 'Sign in']);
  await expect(page.getByText('closed beta', { exact: true })).toBeVisible();
  // #1476: the steps lay out as the arrow flow, not the agents page's numbered rows.
  await expect(section.locator('.step').first()).toHaveCSS('counter-increment', 'none');
  // Before the loop below, which leaves the page dark and hides the light picture.
  await expectLoaded(page, '.buy-phone img[src$="/media/phone-note-iphone-light.webp"]');
  for (const colorScheme of ['light', 'dark'] as const) {
    for (const viewport of [{ name: '1280', width: 1280, height: 800 }, { name: '390', width: 390, height: 844 }]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize(viewport);
      await section.scrollIntoViewIfNeeded();
      await expect(section.locator('[data-reveal]:not(.in)')).toHaveCount(0);
      await section.screenshot({ path: test.info().outputPath(`download-after-install-${colorScheme}-${viewport.name}.png`), animations: 'disabled' });
    }
  }
});

// #1476: the agents page's extension steps keep their numbered rows, saved for the PR.
for (const colorScheme of ['light', 'dark'] as const) {
  for (const viewport of [{ name: '1280', width: 1280, height: 800 }, { name: '390', width: 390, height: 844 }]) {
    test(`agents page, extension steps, ${colorScheme}, ${viewport.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize(viewport);
      await page.goto('/landing/agents');
      const steps = page.locator('#panel-desktop .mcpb-step');
      await expect(steps).toHaveCount(3);
      await expect(steps.first()).toHaveCSS('counter-increment', /^cmd/);
      const list = page.locator('#panel-desktop > .cmds');
      await list.scrollIntoViewIfNeeded();
      await expect(page.locator('#panel-desktop [data-reveal]:not(.in)')).toHaveCount(0);
      await list.screenshot({ path: test.info().outputPath(`agents-extension-steps-${colorScheme}-${viewport.name}.png`), animations: 'disabled' });
    });
  }
}
