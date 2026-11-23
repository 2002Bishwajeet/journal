import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';

// #1477: every landing site page compared with its committed baseline, so a look nobody approved fails the PR
// (#1476: a global `.step` style from the agents page squashed the download page's "Getting started").
// Full page at 1280 and 390, light and dark. Reduced motion turns off the entrance reveals and the looping demos,
// and the hero videos are masked: their frames and player controls are not the page's look.
// Baselines live in site-visual.spec.ts-snapshots/ and come from CI's Linux image only: a PR that changes the
// look on purpose gets the `update-snapshots` label (see e2e/edge/README.md), which regenerates and commits them.

const PAGES = [
  { name: 'home', path: '/' },
  { name: 'pricing', path: '/landing/pricing' },
  { name: 'download', path: '/landing/download' },
  { name: 'agents', path: '/landing/agents' },
  { name: 'buy', path: '/landing/buy' },
  { name: 'redeem', path: '/landing/redeem' },
  { name: 'privacy', path: '/landing/privacy' },
  { name: 'contact', path: '/landing/contact' },
];
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
];

// Every picture loaded and every lazy part started, so the full page shows what a visitor who scrolled sees.
async function settle(page: Page) {
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll('img')];
    for (const img of images) img.loading = 'eager';
    await Promise.all(images.map((img) => (img.complete ? null : new Promise((done) => { img.onload = img.onerror = done; }))));
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  });
  await expect(page.locator('[data-reveal]:not(.in)')).toHaveCount(0);
  // The home page's Mermaid playground draws once it has been scrolled near: the jump to the bottom skips past it.
  if (await page.locator('#pg-output').count()) {
    await page.locator('.playground').scrollIntoViewIfNeeded();
    await expect(page.locator('.pg-status')).toHaveText('Rendered');
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

for (const { name, path } of PAGES) {
  test(`${name} page looks as its baseline, at 1280 and 390, light and dark`, async ({ page }) => {
    test.setTimeout(120_000);
    for (const viewport of VIEWPORTS) {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await page.setViewportSize(viewport);
        await page.goto(path);
        await expect(page.locator(`body[data-page="${name}"]`)).toBeVisible();
        await settle(page);
        // Soft, so one run shows every view of the page that changed.
        await expect.soft(page).toHaveScreenshot(`${name}-${colorScheme}-${viewport.width}.png`, {
          fullPage: true,
          mask: [page.locator('video')],
          // Tight enough for a squashed section, loose enough for font antialiasing.
          maxDiffPixelRatio: 0.01,
          timeout: 15_000,
        });
      }
    }
  });
}
