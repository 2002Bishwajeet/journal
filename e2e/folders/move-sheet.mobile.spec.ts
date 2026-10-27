import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createFolder, foldersNav, screenshotInBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #826: on a phone, Move to folder is a bottom sheet that shows the current folder and
// offers "New folder…".

const viewport = { width: 393, height: 852 };

const noteRow = (page: Page) => page.locator('[data-testid=note-row]:visible');

/** A note in Main, then its Move to folder sheet. The sidebar is the whole screen on a phone. */
async function openMoveSheet(page: Page) {
  await createFolder(page, 'Trips');
  await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
  await page.getByRole('button', { name: 'New note', exact: true }).tap();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  // Back navigates inside the slide's view transition, a frame later.
  await expect.poll(() => new URL(page.url()).pathname.split('/').filter(Boolean).length).toBe(1);
  await expect(noteRow(page)).toHaveCount(1);
  await noteRow(page).first().click({ button: 'right', position: { x: 12, y: 12 } });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  // The menu zooms in when it opens; a tap during that lands on the row under it.
  await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await menu.getByRole('menuitem', { name: 'Move to folder…' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: 'Main' })).toBeVisible();
  return sheet;
}

test('the sheet sits at the bottom, checks the current folder, and a tap moves the note', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.setViewportSize({ width: 390, height: 852 });
    const sheet = await openMoveSheet(page);

    await expect.poll(async () => {
      const box = await sheet.boundingBox();
      return box ? Math.round(box.y + box.height) : -1;
    }).toBe(viewport.height);

    const current = sheet.getByRole('button', { name: 'Main' });
    await expect(current).toBeDisabled();
    await expect(current).toHaveAttribute('aria-current', 'true');
    expect((await sheet.getByRole('button', { name: 'Trips' }).boundingBox())!.height).toBeGreaterThanOrEqual(52);
    await screenshotInBothThemes(page, (theme) => `move-sheet-${theme}-390x852.png`);

    await sheet.getByRole('button', { name: 'Trips' }).tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(noteRow(page)).toHaveCount(0);
  });
});

test('New folder… makes a folder and moves the note into it', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const sheet = await openMoveSheet(page);
    await sheet.getByRole('button', { name: 'New folder…' }).tap();
    await page.getByPlaceholder('Folder Name').fill('Ideas');
    await page.getByRole('button', { name: 'Create', exact: true }).tap();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(noteRow(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Back to notes' }).click();
    await foldersNav(page).getByRole('button', { name: 'Ideas', exact: true }).click();
    await expect(noteRow(page)).toHaveCount(1);
  });
});

test('Back closes the sheet', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await openMoveSheet(page);
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
