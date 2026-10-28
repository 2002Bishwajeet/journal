import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, createFolder, foldersNav, inBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// On a phone, the note screen's More button opens an action sheet with every note action;
// Find in note and Contents work; Back names its folder; New focuses the title (#825).

const back = (page: Page) => page.getByRole('button', { name: /^Back to (?!notes$)/ });
const more = (page: Page) => page.getByRole('button', { name: 'More', exact: true });
const sheet = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true });
const pathParts = (page: Page) => new URL(page.url()).pathname.split('/').filter(Boolean);

/** The folder list is the first screen on a phone: open `folder`, then New note. */
async function newNoteIn(page: Page, folder: string) {
  await foldersNav(page).getByRole('button', { name: folder, exact: true }).tap();
  await page.getByRole('button', { name: 'New note', exact: true }).tap();
  await expect(activeTitleInput(page)).toBeVisible();
}

// A sheet slides in over 300 ms; wait until its top edge stops moving.
async function settled(el: Locator) {
  let last = -1;
  await expect
    .poll(async () => {
      const y = (await el.boundingBox())?.y ?? -2;
      const same = y === last;
      last = y;
      return same;
    })
    .toBe(true);
  return (await el.boundingBox())!;
}

// Screenshots at 390 px, light then dark; back to the 393 px profile afterwards.
async function shots(page: Page, what: string, ready?: Locator) {
  await page.setViewportSize({ width: 390, height: 844 });
  if (ready) await settled(ready);
  await inBothThemes(page, (theme) => page.screenshot({ path: test.info().outputPath(`${what}-${theme}-390.png`) }));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 393, height: 852 });
  if (ready) await settled(ready);
}

test('More opens an action sheet; Move to folder follows the note and Back names its folder', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createFolder(page, 'Notes lab');
    await createFolder(page, 'Trips');
    await newNoteIn(page, 'Notes lab');

    // New: the caret is in the title, with its "Untitled" selected.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
      .toBe('Note title');

    // Back is a 44 px target that names where it goes.
    const backBox = (await back(page).boundingBox())!;
    expect(backBox.width).toBeGreaterThanOrEqual(44);
    expect(backBox.height).toBeGreaterThanOrEqual(44);
    await expect(back(page)).toHaveAccessibleName('Back to Notes lab');
    await expect(back(page)).toContainText('Notes lab');

    const title = `Sheet note ${Date.now()}`;
    await activeTitleInput(page).fill(title);
    await shots(page, 'note-header-top');

    await more(page).tap();
    const actions = sheet(page, title);
    await expect(actions).toBeVisible();
    for (const name of ['Pin', 'Share…', 'Move to folder…', 'Find in note', 'Version history', 'Archive', 'Move to Trash']) {
      const row = actions.getByRole('menuitem', { name, exact: true });
      await expect(row).toBeVisible();
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // No headings yet, so no Contents.
    await expect(actions.getByRole('menuitem', { name: 'Contents' })).toHaveCount(0);
    await shots(page, 'note-actions-sheet', actions);

    // Move to folder…: the note moves and the URL follows it.
    const before = pathParts(page);
    await actions.getByRole('menuitem', { name: 'Move to folder…' }).tap();
    const picker = page.getByRole('dialog', { name: /Move/ });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Trips' }).tap();
    await expect.poll(() => pathParts(page)[0]).not.toBe(before[0]);
    expect(pathParts(page)[1]).toBe(before[1]);
    await expect(back(page)).toHaveAccessibleName('Back to Trips');
  });
});

test('Find in note and Contents work from the sheet', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createFolder(page, 'Notes lab');
    await newNoteIn(page, 'Notes lab');
    const title = `Contents note ${Date.now()}`;
    await activeTitleInput(page).fill(title);

    // A long note with a heading at each end.
    await activeEditor(page).tap();
    await page.keyboard.type('# Alpha');
    await page.keyboard.press('Enter');
    for (let i = 1; i <= 40; i++) {
      await page.keyboard.insertText(`Filler line ${i}`);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('# Omega');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('The end');

    // Find in note: the bar sits under the header with its field focused.
    await more(page).tap();
    await sheet(page, title).getByRole('menuitem', { name: 'Find in note' }).tap();
    const find = page.getByRole('search', { name: 'Find and replace' });
    const field = find.getByRole('textbox', { name: 'Find in note' });
    await expect(field).toBeFocused();
    const backBox = (await back(page).boundingBox())!;
    expect((await find.boundingBox())!.y).toBeGreaterThanOrEqual(backBox.y + backBox.height);
    await field.fill('Omega');
    await expect(find.getByText('1 of 1')).toBeVisible();
    await find.getByRole('button', { name: 'Close' }).tap();
    await expect(find).toBeHidden();

    // Contents: the headings, in order; a tap scrolls to one and closes the sheet.
    const alpha = activeEditor(page).getByRole('heading', { name: 'Alpha' });
    const omega = activeEditor(page).getByRole('heading', { name: 'Omega' });
    await more(page).tap();
    await sheet(page, title).getByRole('menuitem', { name: 'Contents' }).tap();
    const contents = sheet(page, 'Contents');
    await expect(contents).toBeVisible();
    const entries = contents.getByRole('navigation', { name: 'Table of contents' }).getByRole('button');
    await expect(entries).toHaveText(['Alpha', 'Omega']);
    for (const entry of await entries.all()) expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await shots(page, 'note-contents', contents);

    await contents.getByRole('button', { name: 'Alpha' }).tap();
    await expect(contents).toBeHidden();
    await expect(alpha).toBeInViewport();

    await more(page).tap();
    await sheet(page, title).getByRole('menuitem', { name: 'Contents' }).tap();
    await sheet(page, 'Contents').getByRole('button', { name: 'Omega' }).tap();
    await expect(omega).toBeInViewport();

    // The big title is out of view, so the header shows the small one.
    const small = page.locator('span[aria-hidden="false"]').filter({ hasText: title });
    await expect(small).toHaveCSS('opacity', '1');
    await shots(page, 'note-header-scrolled');
  });
});

test('Move to Trash asks first, then shows the list', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createFolder(page, 'Notes lab');
    await newNoteIn(page, 'Notes lab');
    const title = `Trash note ${Date.now()}`;
    await activeTitleInput(page).fill(title);

    await more(page).tap();
    await sheet(page, title).getByRole('menuitem', { name: 'Move to Trash' }).tap();
    const alert = page.getByRole('dialog', { name: 'Move to Trash?' });
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'Cancel' }).tap();
    await expect(alert).toBeHidden();
    expect(pathParts(page)).toHaveLength(2);

    await more(page).tap();
    await sheet(page, title).getByRole('menuitem', { name: 'Move to Trash' }).tap();
    await page.getByRole('dialog', { name: 'Move to Trash?' }).getByRole('button', { name: 'Move to Trash' }).tap();
    await expect.poll(() => pathParts(page)).toHaveLength(1);
    await expect(page.getByTestId('note-row').filter({ hasText: title })).toHaveCount(0);
  });
});
