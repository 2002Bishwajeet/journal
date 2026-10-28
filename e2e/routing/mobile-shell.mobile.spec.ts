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

    // Trash is the footer's last row on a phone (Log out is in Settings, #830).
    const footer = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Trash/ });
    await expect(footer).toBeVisible();
    const box = await footer.boundingBox();
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
    const footer = await sidebar.getByRole('button', { name: /^Trash/ }).boundingBox();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(852 - 34);
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

    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    const first = sidebar.getByRole('button').first();
    await expect(first).toBeVisible();
    // The sidebar pane slides to the inset (transition-all on its wrapper), so poll until it settles.
    await expect.poll(async () => (await first.boundingBox())!.x).toBeGreaterThanOrEqual(47);
    await expect.poll(async () => { const box = (await sidebar.boundingBox())!; return box.x + box.width; }).toBeLessThanOrEqual(852 - 47);

    await page.screenshot({ path: test.info().outputPath('landscape-sidebar-light-852x393.png') });
  });
});

test('under a status bar, the focus-mode exit pill sits below the note header', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Emulation.setSafeAreaInsetsOverride is Chromium only');
  await withMobilePage(browser, async (page) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34 } });
    await page.getByRole('complementary', { name: 'Sidebar' }).getByText('Main', { exact: true }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await expect(page.locator('.ProseMirror').last()).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Shift+KeyF');
    const pill = page.getByRole('button', { name: /Exit Focus/ });
    await expect(pill).toBeVisible();

    // Below the 59px status bar and the 48px note header (back button and title).
    await expect.poll(async () => (await pill.boundingBox())!.y).toBeGreaterThanOrEqual(59 + 48);

    await page.screenshot({ path: test.info().outputPath('focus-pill-light-393x852.png') });
  });
});
