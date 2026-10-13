import { test, expect, waitForAppReady } from '../fixtures';
import type { Page } from '@playwright/test';
import { createFolder, createNote, foldersNav, inBothThemes, selectFolder, waitForNoteSaved } from '../support/actions';

// #639: the Share dialog's "Show on my public page" switch. Backend-free like
// share-folder.spec.ts: a shared folder makes the note public locally, so the dialog
// is in its public state. The Pages Function side is covered by edge/share-unlisted.spec.ts.

const FOLDER = 'Blog';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

async function openShareDialog(page: Page, title: string) {
  await page.getByRole('button').filter({ hasText: title }).first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Share' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Show on my public page')).toBeVisible();
  return dialog;
}

async function shot(page: Page, width: number, state: string) {
  await inBothThemes(page, (theme) =>
    page.screenshot({ path: test.info().outputPath(`share-dialog-${state}-${theme}-${width}.png`), animations: 'disabled' })
  );
}

test('the Show on my public page switch persists, and disables the search-engine switch while off', async ({ app }) => {
  test.setTimeout(60_000);
  await app.setViewportSize(DESKTOP);
  await createFolder(app, FOLDER);
  await selectFolder(app, FOLDER);
  await createNote(app, { title: 'Quiet post', body: 'Hello' });

  await foldersNav(app).getByRole('button', { name: FOLDER, exact: true }).click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Share folder…' }).click();
  await app.getByRole('dialog', { name: 'Share Folder' }).getByRole('button', { name: 'Share folder', exact: true }).click();
  await expect(app.getByText('Folder shared. 1 note made public.')).toBeVisible();
  await app.keyboard.press('Escape');

  let dialog = await openShareDialog(app, 'Quiet post');
  const listed = dialog.getByLabel('Show on my public page');
  const hide = dialog.getByLabel('Hide from search engines');
  await expect(listed).toBeChecked();
  await expect(hide).toBeEnabled();
  await shot(app, DESKTOP.width, 'listed');

  await listed.click();
  await expect(listed).not.toBeChecked();
  await expect(hide).toBeChecked();
  await expect(hide).toBeDisabled();
  await shot(app, DESKTOP.width, 'unlisted');
  await app.keyboard.press('Escape');

  // It survives a reload (phone-sized, so the list is reached from the sidebar).
  await waitForNoteSaved(app);
  await app.evaluate(() => localStorage.removeItem('journal-session-state'));
  await app.setViewportSize(MOBILE);
  await app.goto('/');
  await waitForAppReady(app);
  await selectFolder(app, FOLDER);
  dialog = await openShareDialog(app, 'Quiet post');
  await expect(dialog.getByLabel('Show on my public page')).not.toBeChecked();
  await expect(dialog.getByLabel('Hide from search engines')).toBeDisabled();
  await shot(app, MOBILE.width, 'unlisted');

  await dialog.getByLabel('Show on my public page').click();
  await expect(dialog.getByLabel('Show on my public page')).toBeChecked();
  await expect(dialog.getByLabel('Hide from search engines')).toBeEnabled();
  await shot(app, MOBILE.width, 'listed');
});
