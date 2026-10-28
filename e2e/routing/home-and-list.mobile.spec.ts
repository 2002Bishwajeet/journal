import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { createFolder, inBothThemes, selectFolder } from '../support/actions';

// Phone home and list screens (#830): large titles, real empty states, room for the
// tab bar and the New note button (#853), Log out in Settings and Empty Trash in a sheet.

const PROJECTS = 'Projects';
const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Tabs' });
const tab = (page: Page, name: string) => tabBar(page).getByRole('button', { name, exact: true });
const fab = (page: Page) => page.getByRole('button', { name: 'New note', exact: true });
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });
/** The large title and the empty state of the screen on show (hidden panes are display: none). */
const largeTitle = (page: Page) => page.locator('[data-large-title]').locator('visible=true');
const emptyState = (page: Page) => page.locator('[data-empty-state]').locator('visible=true');
const barTitle = (page: Page) => page.locator('[data-bar-title]').locator('visible=true');

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

/** `locator` ends above the New note button (when shown) and the tab bar, and starts below the notch. */
async function expectClearOfChrome(page: Page, locator: Locator, browserName: string) {
  const b = await box(locator);
  if (browserName === 'chromium') expect(b.y).toBeGreaterThanOrEqual(59);
  const above = [await box(tabBar(page))];
  if (await fab(page).count()) above.push(await box(fab(page)));
  for (const other of above) expect(b.y + b.height).toBeLessThanOrEqual(other.y);
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

async function addNote(page: Page) {
  await fab(page).click();
  await page.getByRole('button', { name: /^Back to (?!notes$)/ }).click();
  await expect(largeTitle(page)).toHaveText(PROJECTS);
}

test('home: a large title clear of the tab bar and the New note button, and no Log out', async ({ browser, browserName }) => {
  await withMobilePage(browser, async (page) => {
    // Layout only: no push slide, so screenshots never land mid-slide.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await safeArea(page, browserName);

    await expect(largeTitle(page)).toHaveText('Journal');
    await expect(largeTitle(page)).toHaveCSS('font-size', '34px');
    await expect(fab(page)).toBeVisible();
    await expect(tabBar(page)).toBeVisible();
    await expect(barTitle(page)).toHaveCount(0);
    await expectClearOfChrome(page, largeTitle(page), browserName);

    // Phones sign out in Settings → Account.
    await expect(sidebar(page).getByRole('button', { name: /Log out/ })).toHaveCount(0);
    await shots(page, 'home');

    await tab(page, 'Settings').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Account', exact: true }).click();
    await expect(dialog.getByRole('button', { name: /Sign out/ })).toBeVisible();
  });
});

test('an empty folder says so and its New note button writes the note there', async ({ browser, browserName }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await safeArea(page, browserName);
    await createFolder(page, PROJECTS);
    await selectFolder(page, PROJECTS);

    await expect(largeTitle(page)).toHaveText(PROJECTS);
    await expect(emptyState(page)).toContainText('No notes in Projects');
    await expectClearOfChrome(page, largeTitle(page), browserName);
    await expectClearOfChrome(page, emptyState(page), browserName);
    await shots(page, 'empty-folder');

    await emptyState(page).getByRole('button', { name: 'New note in Projects' }).click();
    const back = page.getByRole('button', { name: `Back to ${PROJECTS}` });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.getByTestId('note-row')).toHaveCount(1);
    await expect(emptyState(page)).toHaveCount(0);
  });
});

test('the large title collapses into the bar on scroll', async ({ browser }) => {
  test.setTimeout(120_000);
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createFolder(page, PROJECTS);
    await selectFolder(page, PROJECTS);
    const viewport = page.locator('[data-radix-scroll-area-viewport]').locator('visible=true').filter({ has: largeTitle(page) });
    await addNote(page);
    for (let i = 0; i < 20; i++) {
      if ((await viewport.evaluate((el) => el.scrollHeight - el.clientHeight)) >= 300) break;
      await addNote(page);
    }

    await expect(largeTitle(page)).toBeInViewport();
    await expect(barTitle(page)).toHaveCount(0);

    await viewport.evaluate((el) => { el.scrollTop = 300; });
    await expect(barTitle(page)).toHaveText(PROJECTS);
    await expect(barTitle(page)).toHaveCSS('opacity', '1');
    await expect(largeTitle(page)).not.toBeInViewport();
    await shots(page, 'list-scrolled');

    await viewport.evaluate((el) => { el.scrollTop = 0; });
    await expect(barTitle(page)).toHaveCount(0);
  });
});

test('Shared with no notes explains itself and offers no New', async ({ browser, browserName }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await safeArea(page, browserName);
    await tab(page, 'Shared').click();

    await expect(largeTitle(page)).toHaveText('Shared');
    await expect(emptyState(page)).toContainText('Notes others share with you appear here.');
    await expect(emptyState(page).getByRole('button')).toHaveCount(0);
    await expect(fab(page)).toHaveCount(0);
    await expectClearOfChrome(page, emptyState(page), browserName);
    await shots(page, 'empty-shared');
  });
});

test('Trash: Empty Trash is in the More sheet, behind a confirm', async ({ browser, browserName }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await safeArea(page, browserName);

    await sidebar(page).getByRole('button', { name: /^Trash/ }).click();
    await expect(largeTitle(page)).toHaveText('Trash');
    await expect(emptyState(page)).toContainText('Deleted notes stay here until you empty Trash.');
    await expectClearOfChrome(page, emptyState(page), browserName);
    await shots(page, 'empty-trash');
    await page.getByRole('button', { name: 'Back to notes' }).click();

    // Put one note in Trash.
    await createFolder(page, PROJECTS);
    await selectFolder(page, PROJECTS);
    await addNote(page);
    await page.getByTestId('note-row').first().getByRole('button').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
    await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await page.getByRole('button', { name: 'Back to notes' }).click();
    await sidebar(page).getByRole('button', { name: /^Trash/ }).click();
    await expect(page.getByRole('button', { name: 'Restore note' })).toBeVisible();

    // The title row holds Back and More only.
    await expect(page.getByRole('button', { name: 'Empty Trash' })).toHaveCount(0);
    const more = page.getByRole('button', { name: 'More', exact: true });
    const b = await box(more);
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);

    await more.click();
    const sheet = page.getByRole('menu', { name: 'Trash actions' });
    await expect(sheet.getByRole('menuitem', { name: 'Empty Trash' })).toBeVisible();
    await shots(page, 'trash-more');
    await sheet.getByRole('menuitem', { name: 'Empty Trash' }).click();
    const confirm = page.getByRole('dialog', { name: 'Empty Trash?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Empty Trash' }).click();
    await expect(confirm).toBeHidden();
    await expect(emptyState(page)).toContainText('Trash is empty');
  });
});
