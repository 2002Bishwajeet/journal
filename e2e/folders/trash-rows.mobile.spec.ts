import type { CDPSession, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { inBothThemes, openSettingsSection, selectFolder } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #977: Trash on a phone. Row text stays inside the 16 px gutter, each row says when the
// note was last edited, there is no scrollbar, and a long press opens Restore and Delete
// forever in a bottom sheet. A left swipe shows Delete forever, as the note list does (#778).

const viewport = { width: 390, height: 844 };
const LONG = 'Meeting prep: a long title for the quarterly planning and roadmap review with the whole team';
const KEEP = 'Keep this one';
const GONE = 'Gone for good';
const TITLES = [LONG, KEEP, GONE];

const seedFiles = () =>
  TITLES.map((title, i) => ({
    name: `trash-${i}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from(`---\ntitle: ${title}\n---\nThe body keeps going with enough words that its preview runs past the right edge of a phone screen\n`),
  }));

const trashRows = (page: Page) => page.getByTestId('hidden-note-row');
const trashRow = (page: Page, title: string) => trashRows(page).filter({ hasText: title });

/** Imports TITLES into Main, moves each to Trash from the note list, and opens Trash. */
async function fillTrash(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await openSettingsSection(dialog, 'Data & storage');
  await dialog.locator('input[type="file"]').setInputFiles(seedFiles());
  await expect(page.getByText(`Successfully imported ${TITLES.length} notes`)).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');
  await selectFolder(page, 'Main');
  for (const title of TITLES) {
    await page.getByTestId('note-row').filter({ hasText: title }).click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Move to Trash' }).tap();
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Move to Trash' }).click();
    await expect(page.getByTestId('note-row').filter({ hasText: title })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Back to notes' }).click();
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Trash/ }).click();
  for (const title of TITLES) await expect(page.getByText(title)).toBeVisible();
}

/** Every row lies within the screen, and its text within the 16 px gutter. */
async function expectInsideGutter(page: Page) {
  const list = page.locator('[data-radix-scroll-area-viewport]').filter({ has: trashRows(page).first() });
  const overflow = await list.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const row of await trashRows(page).all()) {
    expect(await row.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    for (const text of await row.locator('p').all()) {
      const b = (await text.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(16);
      expect(b.x + b.width).toBeLessThanOrEqual(viewport.width - 16);
    }
  }
}

async function expectSheetOnScreen(menu: Locator) {
  await expect(menu.getByRole('menuitem', { name: 'Restore note' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Delete forever' })).toBeVisible();
  await menu.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  for (const item of await menu.getByRole('menuitem').all()) {
    const b = (await item.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(viewport.width);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
}

test('Trash rows stay in the gutter, and a long press restores or deletes forever', async ({ browser }) => {
  test.setTimeout(120_000);
  await withMobilePage(browser, async (page) => {
    // No push slide (#779), so screenshots never land mid-slide.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fillTrash(page);
    await inBothThemes(page, (theme) =>
      page.screenshot({ path: test.info().outputPath(`trash-${theme}-390x844.png`) }),
    );
    await page.emulateMedia({ colorScheme: 'light' });

    await expectInsideGutter(page);
    // When the note was last edited: Trash keeps no deletion date and never empties itself.
    for (const title of TITLES) await expect(trashRow(page, title)).toContainText(/Edited (Just now|\d+m ago)/);

    // No scrollbar, even with the finger on a list that scrolls.
    await page.setViewportSize({ width: viewport.width, height: 360 });
    await trashRows(page).first().hover();
    await expect(page.locator('[data-pane="note-list"] [data-slot="scroll-area-scrollbar"]').locator('visible=true')).toHaveCount(0);
    await page.setViewportSize(viewport);

    // The … button is 44 px and inside the screen.
    const options = trashRow(page, LONG).getByRole('button', { name: 'Note options' });
    const ob = (await options.boundingBox())!;
    expect(ob.width).toBeGreaterThanOrEqual(44);
    expect(ob.height).toBeGreaterThanOrEqual(44);
    expect(ob.x + ob.width).toBeLessThanOrEqual(viewport.width);

    // Long press, Restore: the note leaves Trash.
    await trashRow(page, KEEP).click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expectSheetOnScreen(menu);
    await inBothThemes(page, (theme) =>
      page.screenshot({ path: test.info().outputPath(`trash-row-actions-${theme}-390x844.png`) }),
    );
    await page.emulateMedia({ colorScheme: 'light' });
    await menu.getByRole('menuitem', { name: 'Restore note' }).tap();
    await expect(trashRow(page, KEEP)).toHaveCount(0);

    // Long press, Delete forever: the note leaves Trash.
    await trashRow(page, GONE).click({ button: 'right' });
    await expectSheetOnScreen(menu);
    await menu.getByRole('menuitem', { name: 'Delete forever' }).tap();
    await expect(trashRow(page, GONE)).toHaveCount(0);
    await expect(trashRows(page)).toHaveCount(1);

    // The restored note is back in Main; the deleted one is not.
    await page.getByRole('button', { name: 'Back to notes' }).click();
    await selectFolder(page, 'Main');
    await expect(page.getByTestId('note-row').filter({ hasText: KEEP })).toBeVisible();
    await expect(page.getByTestId('note-row').filter({ hasText: GONE })).toHaveCount(0);
  });
});

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [p] : [] });
}

test('a left swipe on a Trash row shows Delete forever, which deletes it', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Input.dispatchTouchEvent is Chromium only');
  test.setTimeout(120_000);
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fillTrash(page);
    const row = trashRow(page, LONG);
    const rb = (await row.boundingBox())!;
    const y = rb.y + rb.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, 'touchStart', { x: 300, y });
    for (let i = 1; i <= 12; i++) await touch(cdp, 'touchMove', { x: 300 - (100 * i) / 12, y });
    await touch(cdp, 'touchEnd');

    const del = row.getByRole('button', { name: 'Delete forever' });
    await expect.poll(async () => {
      const b = await del.boundingBox();
      return !!b && b.x + b.width <= rb.x + rb.width + 1 && b.x < rb.x + rb.width - 40;
    }).toBe(true);
    await inBothThemes(page, (theme) =>
      page.screenshot({ path: test.info().outputPath(`trash-row-swiped-${theme}-390x844.png`) }),
    );
    await del.tap();
    await expect(row).toHaveCount(0);
    await expect(trashRows(page)).toHaveCount(TITLES.length - 1);
  });
});
