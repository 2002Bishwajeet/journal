import { devices, type Browser, type Page } from '@playwright/test';
import { withFencedPage, waitForAppReady } from '../fixtures';
import { assertTestOrigin } from './origin-guard';

export async function withTabletPage(
  browser: Browser,
  size: { width: number; height: number },
  body: (page: Page) => Promise<void>,
): Promise<void> {
  // A touch tablet window (#832); 820x1180 is iPad portrait.
  await withFencedPage(
    browser,
    { viewport: size, hasTouch: true, storageState: 'e2e/fixtures/hermetic-auth.json', serviceWorkers: 'block' },
    async (page) => {
      await page.goto('/');
      await assertTestOrigin(page);
      await waitForAppReady(page);
      await body(page);
    },
  );
}

// Runs `body` with a signed-in, booted page on an iPhone 15 profile (393x852,
// isMobile, hasTouch, full 852 px tall) in a fenced context: same storage state and boot as the
// `app` fixture. The mobile-chromium and mobile-webkit projects pick the engine;
// the device profile is the same for both.
export async function withMobilePage(
  browser: Browser,
  body: (page: Page) => Promise<void>,
): Promise<void> {
  const { defaultBrowserType: _engine, ...iphone } = devices['iPhone 15'];
  await withFencedPage(
    browser,
    { ...iphone, viewport: { width: 393, height: 852 }, storageState: 'e2e/fixtures/hermetic-auth.json', serviceWorkers: 'block' },
    async (page) => {
      await page.goto('/');
      await assertTestOrigin(page);
      await waitForAppReady(page);
      await body(page);
    },
  );
}
