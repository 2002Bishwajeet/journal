import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createFolder, createNote, foldersNav, screenshotInBothThemes, selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #682: one Share dialog per note, like Google Docs: people and circles with a role, and
// the public link under General access. Backend-free, so this covers the menu, the
// dialog's states and what turning the link on and off does without a Homebase (the
// drive call fails and the note stays as it was). A shared folder makes a note public
// locally, which shows the public state. Sharing with people is covered by the live
// specs next to this one.

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

/** Screenshots the open dialog at 1280 and, as a sheet, at 390, in both themes. */
async function shootBothWidths(page: Page, state: string) {
  await screenshotInBothThemes(page, (theme) => `share-dialog-${state}-${theme}-1280.png`);
  await page.setViewportSize(PHONE);
  await expect(page.getByRole('dialog', { name: 'Share Note' })).toBeVisible();
  await screenshotInBothThemes(page, (theme) => `share-dialog-${state}-${theme}-390.png`);
  await page.setViewportSize(DESKTOP);
}

async function openNoteMenu(page: Page, title: string) {
  await page.getByTestId('note-row').filter({ hasText: title }).click({ button: 'right' });
}

test('one Share… item opens the Share dialog, and the public link turns on and off from it', async ({ app }) => {
  test.setTimeout(90_000);
  await assertTestOrigin(app);
  await app.setViewportSize(DESKTOP);
  const stamp = Date.now();
  const title = `Share dialog ${stamp}`;
  await createNote(app, { title, body: 'A note to share.' });

  // 1. The note menu has one Share… item, and nothing about collaboration.
  await openNoteMenu(app, title);
  const menu = app.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Share…', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Collaborat|Edit Sharing/ })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: /^Share/ })).toHaveCount(1);
  await menu.getByRole('menuitem', { name: 'Share…' }).click();

  // 2. The dialog: people with access (the owner first), and General access restricted.
  const dialog = app.getByRole('dialog', { name: 'Share Note' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'People with access' })).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'People with access' })).toContainText('Owner');
  await expect(dialog.getByRole('heading', { name: 'General access' })).toBeVisible();
  await expect(dialog.getByText('Restricted (only people with access)')).toBeVisible();
  await expect(dialog.getByText('Link preview', { exact: true })).toBeVisible();
  // Not shared yet: nothing to stop
  await expect(dialog.getByRole('button', { name: 'Stop sharing', exact: true })).toHaveCount(0);
  const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shootBothWidths(app, 'restricted');

  // 3. Turning the link on runs the publish; without a backend it fails, and says so.
  await dialog.getByRole('button', { name: 'Make Note Public' }).click();
  await expect(app.getByText('Failed to make note public')).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText('Restricted (only people with access)')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();

  // 4. A note in a shared folder is public: the dialog shows the link, and says why
  // it can't also be shared with people.
  const folder = `Shared ${stamp}`;
  await createFolder(app, folder);
  await selectFolder(app, folder);
  const publicTitle = `Public note ${stamp}`;
  await createNote(app, { title: publicTitle, body: 'Hello' });
  await foldersNav(app).getByRole('button', { name: folder, exact: true }).click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Share folder…' }).click();
  await app.getByRole('dialog', { name: 'Share Folder' }).getByRole('button', { name: 'Share folder', exact: true }).click();
  await expect(app.getByText('Folder shared. 1 note made public.')).toBeVisible();
  await app.keyboard.press('Escape');

  await openNoteMenu(app, publicTitle);
  await app.getByRole('menuitem', { name: 'Share…' }).click();
  await expect(dialog.getByText('Anyone with the link can view')).toBeVisible();
  await expect(dialog.locator('input[readonly]')).toHaveCount(1);
  await expect(dialog.getByText('This note is in a shared folder, so it is public.')).toBeVisible();
  await expect(dialog.getByLabel('Add people or circles')).toHaveCount(0);
  await shootBothWidths(app, 'public');

  // 5. Turning the link off runs the unpublish; without a backend it fails, and the link stays.
  await dialog.getByRole('button', { name: 'Stop sharing (make private)' }).click();
  await expect(app.getByText('Failed to stop sharing')).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText('Anyone with the link can view')).toBeVisible();
  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
