import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { createFolder, inBothThemes, selectFolder } from '../support/actions';

// On a phone, Notes, Shared, Search and Settings are a tab bar at the bottom (#853).

const PROJECTS = 'Projects';
const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Tabs' });
const tab = (page: Page, name: string) => tabBar(page).getByRole('button', { name, exact: true });
const fab = (page: Page) => page.getByRole('button', { name: 'New note', exact: true });
const pathOf = (page: Page) => new URL(page.url()).pathname;

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

/** iPhone 15 notch and home indicator (Chromium only). */
async function safeArea(page: Page, browserName: string) {
  if (browserName !== 'chromium') return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34 } });
}

/** Screenshots at 390 and 430 px wide, in light and dark; leaves the page at 393x852 in light. */
async function shots(page: Page, name: string) {
  for (const [width, height] of [[390, 844], [430, 932]]) {
    await page.setViewportSize({ width, height });
    await inBothThemes(page, async (theme) => {
      await page.screenshot({ path: test.info().outputPath(`${name}-${theme}-${width}x${height}.png`) });
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 393, height: 852 });
}

test('home shows the four tabs above the home indicator, and the New note button above them', async ({ browser, browserName }) => {
  await withMobilePage(browser, async (page) => {
    // Layout only: no push slide, so screenshots never land mid-slide.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await safeArea(page, browserName);

    await expect(tabBar(page).getByRole('button')).toHaveText(['Notes', 'Shared', 'Search', 'Settings']);
    await expect(tab(page, 'Notes')).toHaveAttribute('aria-current', 'page');
    for (const name of ['Shared', 'Search', 'Settings']) await expect(tab(page, name)).not.toHaveAttribute('aria-current');

    for (const name of ['Notes', 'Shared', 'Search', 'Settings']) {
      const b = await box(tab(page, name));
      expect(b.width, name).toBeGreaterThanOrEqual(44);
      expect(b.height, name).toBeGreaterThanOrEqual(44);
      if (browserName === 'chromium') expect(b.y + b.height, name).toBeLessThanOrEqual(852 - 34);
    }
    const bar = await box(tabBar(page));
    expect(bar.y + bar.height).toBe(852);

    const b = await box(fab(page));
    expect(b.width).toBeGreaterThanOrEqual(56);
    expect(b.height).toBeGreaterThanOrEqual(56);
    expect(b.y + b.height).toBe(bar.y - 16);

    // The Settings and Shared rows are tabs now; the sidebar keeps Search and Log out.
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    await expect(sidebar.getByRole('button', { name: /Settings/ })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: /Shared with me/ })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: /Search/ })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /Log out/ })).toBeVisible();

    await shots(page, 'tab-bar-home');
  });
});

test('a tab keeps its place, and switching tabs adds no history entry', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createFolder(page, PROJECTS);
    await selectFolder(page, PROJECTS);
    await expect(page.getByRole('heading', { name: PROJECTS })).toBeVisible();
    const projects = pathOf(page);
    const length = await page.evaluate(() => history.length);

    await tab(page, 'Shared').click();
    await expect.poll(() => pathOf(page)).toBe('/shared');
    await expect(tab(page, 'Shared')).toHaveAttribute('aria-current', 'page');
    await expect(tab(page, 'Notes')).not.toHaveAttribute('aria-current');
    await expect(fab(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Shared' })).toBeVisible();
    expect(await page.evaluate(() => history.length)).toBe(length);
    await shots(page, 'tab-bar-shared');

    await tab(page, 'Notes').click();
    await expect.poll(() => pathOf(page)).toBe(projects);
    await expect(page.getByRole('heading', { name: PROJECTS })).toBeVisible();
    expect(await page.evaluate(() => history.length)).toBe(length);

    // The active tab pops to its root.
    await tab(page, 'Notes').click();
    await expect.poll(() => pathOf(page)).toBe('/');
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
  });
});

test('Search and Settings open their sheets over the tab bar, and Back closes them', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const name of ['Search', 'Settings']) {
      const url = page.url();
      const bar = await box(tabBar(page));
      await tab(page, name).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      // The sheet covers the bar: the point at the bar's centre belongs to the dialog.
      await expect.poll(() =>
        page.evaluate(
          ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role="dialog"]'),
          { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 },
        ),
      ).toBe(true);
      await page.goBack();
      await expect(dialog).toBeHidden();
      expect(page.url()).toBe(url);
      await expect(tabBar(page)).toBeVisible();
    }
  });
});

test('a toast sits above the tab bar and the New note button', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await tab(page, 'Settings').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'About', exact: true }).click();
    await dialog.getByRole('button', { name: 'Copy' }).click();
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(fab(page)).toBeVisible();
    await expect(toast).toBeVisible();

    const bar = await box(tabBar(page));
    for (const other of [bar, await box(fab(page))]) {
      const t = await box(toast);
      expect(t.y + t.height).toBeLessThanOrEqual(other.y);
    }
    // Hovering keeps the toast on screen while the shots are taken.
    await toast.hover();
    await shots(page, 'tab-bar-toast');
  });
});

test('a tablet and a desktop window have no tab bar and no New note button', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await expect(tabBar(page)).toBeVisible();
    for (const [width, height] of [[820, 1180], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      await expect(tabBar(page)).toHaveCount(0);
      await expect(fab(page)).toHaveCount(0);
    }
  });
});
