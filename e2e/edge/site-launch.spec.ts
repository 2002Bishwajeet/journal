import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// #1294: the landing site's launch pages, as the deploy serves them (store badges off by default).
// Each page at desktop and phone width, in light and dark, saved for the PR.

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'download', path: '/landing/download' },
  { name: 'pricing', path: '/landing/pricing' },
  { name: 'buy', path: '/landing/buy' },
];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
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
      // Reduced motion: the entrance reveal (data-reveal) shows everything at once.
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.setViewportSize(viewport);
      for (const { name, path } of PAGES) {
        await page.goto(path);
        await expect(page.locator('h1')).toBeVisible();
        await expect(page.locator('.store-badges')).toHaveCount(0);
        await loadAllPictures(page);
        await page.screenshot({ path: test.info().outputPath(`${name}-${colorScheme}-${viewport.name}.png`), fullPage: true });
      }
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

test('the download page shows the three getting-started steps', async ({ page }) => {
  await page.goto('/landing/download');
  const steps = page.getByRole('heading', { name: 'Getting started' }).locator('xpath=ancestor::section').locator('.step-title');
  await expect(steps).toHaveText(['Install', 'Create a Homebase identity', 'Sign in']);
  await expect(page.getByText('closed beta', { exact: true })).toBeVisible();
  await expectLoaded(page, '.buy-phone img[src$="/media/phone-note-iphone-light.webp"]');
});
