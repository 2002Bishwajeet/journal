import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { createFolder, selectFolder, screenshotInBothThemes, waitForNoteSaved } from '../support/actions';

// On a phone, New note is a 56 px floating button at the bottom right (#878).

const FOLDER = 'Fab folder';
const fab = (page: Page) => page.getByRole('button', { name: 'New note', exact: true });
const back = (page: Page) => page.getByRole('button', { name: /^Back to (?!notes$)/ });
const rows = (page: Page) => page.getByTestId('note-row');

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

/** The folder id of the current route (/:folderId or /:folderId/:noteId). */
const routeFolder = (page: Page) => new URL(page.url()).pathname.split('/')[1];

/** Phone screenshots at 390 px wide, in light and dark. */
async function shots(page: Page, name: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshotInBothThemes(page, (theme) => `${name}-${theme}-390x844.png`);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 393, height: 852 });
}

test('the New note button sits in the thumb zone and opens a note in the right folder', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    // Layout only: no push slide, so screenshots never land mid-slide.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await test.step('home: 56 x 56, 16 px from the right edge and 16 px above the tab bar', async () => {
      await expect(fab(page)).toBeVisible();
      const b = await box(fab(page));
      expect(b.width).toBe(56);
      expect(b.height).toBe(56);
      expect(b.x + b.width).toBe(393 - 16);
      expect(b.y + b.height).toBe(852 - 49 - 16);
      // The sidebar footer ends above it.
      const logout = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /Log out/ });
      expect((await box(logout)).y + (await box(logout)).height).toBeLessThanOrEqual(b.y);
      await shots(page, 'fab-home');
    });

    await test.step('pressed: scales to 0.96', async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const b = await box(fab(page));
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await expect(fab(page)).toHaveCSS('transform', 'matrix(0.96, 0, 0, 0.96, 0, 0)');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(fab(page)).toHaveCSS('transform', 'matrix(0.96, 0, 0, 0.96, 0, 0)');
      await page.screenshot({ path: test.info().outputPath('fab-pressed-light-390x844.png') });
      // Leave without a click.
      await page.mouse.move(10, 10);
      await page.mouse.up();
      await page.setViewportSize({ width: 393, height: 852 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
    });

    await test.step('hidden while a sheet is open', async () => {
      await page.getByRole('button', { name: 'Search' }).first().click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(fab(page)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(fab(page)).toBeVisible();
    });

    await test.step('home: a new note goes to Main', async () => {
      await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).click();
      const main = routeFolder(page);
      await page.getByRole('button', { name: 'Back to notes' }).click();
      await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
      await fab(page).click();
      await expect(back(page)).toBeVisible();
      expect(routeFolder(page)).toBe(main);
      // Hidden inside the note.
      await expect(fab(page)).toHaveCount(0);
      await back(page).click();
      // Back leaves the note for its folder's list or home; either way, return home.
      const toHome = page.getByRole('button', { name: 'Back to notes' });
      await expect(toHome.or(page.getByRole('complementary', { name: 'Sidebar' })).first()).toBeVisible();
      if (await toHome.isVisible()) await toHome.click();
    });

    await test.step('folder list: no header New; a new note goes to this folder', async () => {
      await createFolder(page, FOLDER);
      await selectFolder(page, FOLDER);
      await expect(page.getByRole('heading', { name: FOLDER })).toBeVisible();
      const folder = routeFolder(page);
      await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveCount(0);
      await expect(fab(page)).toBeVisible();

      await fab(page).click();
      await expect(back(page)).toBeVisible();
      expect(routeFolder(page)).toBe(folder);
      await expect(fab(page)).toHaveCount(0);
      await back(page).click();
      await expect(page.getByRole('heading', { name: FOLDER })).toBeVisible();
      await expect(rows(page)).toHaveCount(1);
    });

    await test.step('the last row scrolls clear of the button', async () => {
      for (let i = 0; i < 14; i++) {
        await fab(page).click();
        await back(page).click();
        await expect(rows(page)).toHaveCount(i + 2);
      }
      await shots(page, 'fab-folder');
      const viewport = page.locator('[data-radix-scroll-area-viewport]').filter({ has: rows(page).first() });
      await viewport.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const last = await box(rows(page).last());
      expect(last.y + last.height).toBeLessThanOrEqual((await box(fab(page))).y);
    });
  });
});

test('in a tag list, the New note button tags the new note (#933)', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fab(page).click();
    await expect(back(page)).toBeVisible();
    const main = routeFolder(page);
    await page.getByPlaceholder('Add tags...').fill('work');
    await page.getByPlaceholder('Add tags...').press('Enter');
    await waitForNoteSaved(page);
    await back(page).click();
    const toHome = page.getByRole('button', { name: 'Back to notes' });
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' });
    await expect(toHome.or(sidebar).first()).toBeVisible();
    if (await toHome.isVisible()) await toHome.click();

    await sidebar.getByRole('navigation', { name: 'Tags' }).getByRole('button', { name: /work/ }).click();
    await expect(page.getByRole('heading', { name: '#work' })).toBeVisible();
    await expect(rows(page)).toHaveCount(1);

    await fab(page).click();
    await expect(back(page)).toBeVisible();
    expect(routeFolder(page)).toBe(main);
    await back(page).click();
    // The new note carries `work`, so it joined this list.
    await expect(page.getByRole('heading', { name: '#work' })).toBeVisible();
    await expect(rows(page)).toHaveCount(2);
  });
});
