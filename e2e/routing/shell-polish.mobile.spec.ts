import type { CDPSession, Page, Video } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { foldersNav, inBothThemes, openSettingsSection } from '../support/actions';
import { withMobilePage, withTabletPage } from '../support/mobile';

// #781: the phone and tablet shell as one designed app. Evidence only: the sidebar, a scrolled
// folder list, a row menu, a swiped row, Shared, Trash, search with results and an open note
// header, in light and dark at 393x852 and 768x1024, plus a recording of folder, list, note, Back.
// The swipe uses CDP touch events, so this runs in Chromium only.

const PHONE = { width: 393, height: 852 };
const TABLET = { width: 768, height: 1024 };
const COUNT = 14;
const pad = (i: number) => String(i).padStart(2, '0');

const seedFiles = () =>
  Array.from({ length: COUNT }, (_, k) => {
    const n = pad(k + 1);
    const tags = k % 3 === 0 ? 'tags: [planning, weekly]\n' : k % 4 === 1 ? 'tags: [reading]\n' : '';
    return {
      name: `note-${n}.md`,
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        `---\ntitle: Note ${n} - weekly planning and the reading list\n${tags}---\nBody ${n} keeps going with a few more words so the preview runs across the whole row and past it\n`,
      ),
    };
  });

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });
const rows = (page: Page) => page.locator('[data-testid=note-row]:visible');

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

async function shots(page: Page, what: string) {
  const { width, height } = page.viewportSize()!;
  await inBothThemes(page, async (theme) => {
    await settle(page);
    await page.screenshot({ path: test.info().outputPath(`${what}-${theme}-${width}x${height}.png`) });
  });
  await page.emulateMedia({ colorScheme: 'light' });
}

async function importNotes(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).last().click();
  const dialog = page.getByRole('dialog');
  await openSettingsSection(dialog, 'Data & storage');
  await dialog.locator('input[type="file"]').setInputFiles(seedFiles());
  const toast = page.getByText(`Successfully imported ${COUNT} notes`);
  await expect(toast).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // The toast would cover the bottom of the sidebar in its screenshot.
  await expect(toast).toBeHidden({ timeout: 15_000 });
}

async function swipeFirstRow(cdp: CDPSession, page: Page) {
  const box = (await rows(page).first().boundingBox())!;
  // Low in the row and left of its … button, so the touch never lands on that button.
  const y = box.y + box.height - 12;
  const from = { x: box.x + box.width * 0.7, y };
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y }] });
  await touch('touchStart', from.x);
  for (let i = 1; i <= 12; i++) await touch('touchMove', from.x - (100 * i) / 12);
  await touch('touchEnd');
  await expect(rows(page).first().getByRole('button', { name: 'Move to Trash' })).toBeInViewport();
}

async function trashTwo(page: Page) {
  for (let i = 0; i < 2; i++) {
    const row = rows(page).last();
    const title = (await row.innerText()).split('\n')[0];
    await row.click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Move to Trash' }).tap();
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Move to Trash' }).click();
    await expect(rows(page).filter({ hasText: title })).toHaveCount(0);
  }
}

/** The list-level states: scrolled, a row menu, a swiped row and an open note. Starts and ends on Main's list. */
async function listStates(page: Page) {
  const viewport = rows(page).first().locator('xpath=ancestor::*[@data-radix-scroll-area-viewport][1]');
  await viewport.evaluate((el) => { el.scrollTop = 240; });
  await shots(page, 'list-scrolled');
  await viewport.evaluate((el) => { el.scrollTop = 0; });

  await rows(page).first().getByRole('button', { name: 'Note options', exact: true }).tap();
  await expect(page.getByRole('menu')).toBeVisible();
  await shots(page, 'row-menu');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();

  const cdp = await page.context().newCDPSession(page);
  await swipeFirstRow(cdp, page);
  await shots(page, 'row-swiped');
  await page.getByRole('button', { name: 'Sort notes' }).tap();
  await page.keyboard.press('Escape');

  await rows(page).nth(1).click();
  await expect(page.locator('.ProseMirror').first()).toBeVisible();
  await shots(page, 'note-header');
}

async function searchState(page: Page, open: () => Promise<void>) {
  await open();
  const dialog = page.getByRole('dialog', { name: 'Search notes' });
  await dialog.getByPlaceholder('Search notes...').fill('weekly');
  await expect(dialog.getByRole('button', { name: /Note 01/ })).toBeVisible();
  await shots(page, 'search-results');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

test.describe('shell evidence', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch is Chromium only');

  test('phone 393x852', async ({ browser }) => {
    test.setTimeout(180_000);
    await withMobilePage(browser, async (page) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await importNotes(page);
      await shots(page, 'sidebar');

      await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).click();
      await expect(rows(page).first()).toBeVisible();
      await trashTwo(page);
      await listStates(page);

      await page.getByRole('button', { name: /^Back to (?!notes$)/ }).click();
      await page.getByRole('button', { name: 'Back to notes' }).click();
      await sidebar(page).getByRole('button', { name: /^Trash/ }).click();
      await expect(page.getByTestId('hidden-note-row').first()).toBeVisible();
      await shots(page, 'trash');

      await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Shared' }).click();
      await expect(page.getByText('Nothing shared yet')).toBeVisible();
      await shots(page, 'shared');

      await searchState(page, () => page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Search' }).click());
    });
  });

  test('tablet 768x1024', async ({ browser }) => {
    test.setTimeout(180_000);
    await withTabletPage(browser, TABLET, async (page) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const showFolders = page.getByRole('button', { name: 'Show folders', exact: true });
      if (await showFolders.isVisible()) await showFolders.click();
      await expect(sidebar(page)).toBeVisible();
      await importNotes(page);
      if (!(await sidebar(page).isVisible())) await showFolders.click();
      await shots(page, 'sidebar');

      await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).click();
      await expect(rows(page).first()).toBeVisible();
      await trashTwo(page);
      await listStates(page);

      await searchState(page, async () => {
        await showFolders.click();
        await sidebar(page).getByRole('button', { name: 'Search' }).click();
      });

      // Search opened from the folders overlay, which stays open after it.
      if (!(await sidebar(page).isVisible())) await showFolders.click();
      await sidebar(page).getByRole('button', { name: /^Trash/ }).click();
      await expect(page.getByTestId('hidden-note-row').first()).toBeVisible();
      await shots(page, 'trash');

      await page.goto('/shared');
      await waitForAppReady(page);
      await expect(page.getByText('Nothing shared yet')).toBeVisible();
      await shots(page, 'shared');
    });
  });

  test('recording: folder, list, note, Back at 393px', async ({ browser }) => {
    test.setTimeout(120_000);
    let video: Video | null = null;
    await withMobilePage(
      browser,
      async (page) => {
        video = page.video();
        await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).click();
        await page.getByRole('button', { name: 'New note', exact: true }).click();
        await page.getByRole('button', { name: /^Back to (?!notes$)/ }).click();
        await page.getByRole('button', { name: 'Back to notes' }).click();
        await expect(sidebar(page)).toBeVisible();
        await page.waitForTimeout(500);
        await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).click();
        await page.waitForTimeout(600);
        await rows(page).first().click();
        await page.waitForTimeout(800);
        await page.getByRole('button', { name: /^Back to (?!notes$)/ }).click();
        await page.waitForTimeout(600);
        await page.getByRole('button', { name: 'Back to notes' }).click();
        await page.waitForTimeout(600);
      },
      { recordVideo: { dir: test.info().outputPath('raw-video'), size: PHONE } },
    );
    await (video as Video | null)?.saveAs(test.info().outputPath('folder-list-note-back-light-393x852.webm'));
  });
});
