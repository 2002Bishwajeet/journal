import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';

// The mobile shell fits the real screen (#775): dynamic viewport height, one
// viewport meta tag, and safe-area insets on the left and right.

const shellRoot = (page: Page) => page.locator('#root > div').first();

test('the shell is as tall as the window and the sidebar footer is on screen', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const innerHeight = await page.evaluate(() => window.innerHeight);
    expect(innerHeight).toBe(852);
    const shell = await shellRoot(page).boundingBox();
    expect(shell?.height).toBe(innerHeight);

    const logout = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /Log out/ });
    await expect(logout).toBeVisible();
    const box = await logout.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(innerHeight);

    await page.screenshot({ path: test.info().outputPath('sidebar-light-393x852.png') });
  });
});

test('the page has one viewport meta tag, with viewport-fit=cover', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const contents = await page.evaluate(() =>
      [...document.querySelectorAll('meta[name=viewport]')].map((m) => m.getAttribute('content')),
    );
    expect(contents).toHaveLength(1);
    expect(contents[0]).toContain('viewport-fit=cover');
  });
});

test('a notch keeps the sidebar content out of the unsafe area', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Emulation.setSafeAreaInsetsOverride is Chromium only');
  await withMobilePage(browser, async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34 } });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveClass(/dark/);

    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    // The sidebar animates its padding (transition-all), so poll until the inset settles.
    await expect.poll(async () => (await sidebar.getByRole('button').first().boundingBox())!.y).toBeGreaterThanOrEqual(59);
    const logout = await sidebar.getByRole('button', { name: /Log out/ }).boundingBox();
    expect(logout!.y + logout!.height).toBeLessThanOrEqual(852 - 34);
    // The sidebar's background still runs under the home indicator.
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox!.y + sidebarBox!.height).toBe(852);

    await page.screenshot({ path: test.info().outputPath('notch-sidebar-dark-393x852.png') });
  });
});

test('in landscape, a left inset moves the sidebar content clear of the notch', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Emulation.setSafeAreaInsetsOverride is Chromium only');
  await withMobilePage(browser, async (page) => {
    await page.setViewportSize({ width: 852, height: 393 });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: 47, right: 47 } });

    const first = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button').first();
    await expect(first).toBeVisible();
    const box = await first.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(47);
    const sidebarBox = await page.getByRole('complementary', { name: 'Sidebar' }).boundingBox();
    expect(sidebarBox!.x + sidebarBox!.width).toBeLessThanOrEqual(852 - 47);

    await page.screenshot({ path: test.info().outputPath('landscape-sidebar-light-852x393.png') });
  });
});

test('under a status bar, the focus-mode exit pill sits below the note header', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Emulation.setSafeAreaInsetsOverride is Chromium only');
  await withMobilePage(browser, async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34 } });
    await page.getByRole('complementary', { name: 'Sidebar' }).getByText('Main', { exact: true }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const back = page.getByRole('button', { name: 'Back' }).filter({ visible: true });
    await expect(back).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Shift+KeyF');
    const pill = page.getByRole('button', { name: /Exit Focus/ });
    await expect(pill).toBeVisible();

    const header = (await back.evaluate((el) => el.parentElement!.getBoundingClientRect().toJSON())) as DOMRect;
    expect(header.top).toBeGreaterThanOrEqual(59);
    await expect.poll(async () => (await pill.boundingBox())!.y).toBeGreaterThanOrEqual(header.bottom);

    await page.screenshot({ path: test.info().outputPath('focus-pill-light-393x852.png') });
  });
});
