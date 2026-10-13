import { test, expect, waitForAppReady } from '../fixtures';
import type { Page } from '@playwright/test';
import { createFolder, createNote, foldersNav, inBothThemes, selectFolder, waitForNoteSaved } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #618, #631: the Share folder… dialog from a folder's context menu. Backend-free:
// these notes never reach a server, so sharing flips them locally and their first push
// would upload them public. The share URLs themselves are covered by
// share-folder.live.spec.ts.

const FOLDER = 'Blog';
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

const folderButton = (page: Page, name: string) => foldersNav(page).getByRole('button', { name, exact: true });
const publicBadge = (page: Page, title: string) =>
  page.getByTestId('note-row').filter({ hasText: title }).locator('svg.lucide-globe');

async function shot(page: Page, what: string, width: number) {
  await inBothThemes(page, (theme) =>
    page.screenshot({ path: test.info().outputPath(`${what}-${theme}-${width}.png`), animations: 'disabled' })
  );
}

test('sharing a folder makes its notes public, new notes in it start public, and unsharing reverses it', async ({ app }) => {
  // One run through share, create, reload and unshare, with 14 screenshots.
  test.setTimeout(60_000);
  await app.setViewportSize(DESKTOP);
  await createFolder(app, FOLDER);
  await selectFolder(app, FOLDER);
  await createNote(app, { title: 'First post', body: 'Hello' });
  await createNote(app, { title: 'Second post', body: 'World' });
  await expect(publicBadge(app, 'First post')).toHaveCount(0);

  // Main has no Share folder action (pseudo-folders aren't in the folder list at all).
  await folderButton(app, 'Main').click({ button: 'right' });
  await expect(app.getByRole('menuitem', { name: 'Delete Folder' })).toBeVisible();
  await expect(app.getByRole('menuitem', { name: /Share folder/ })).toHaveCount(0);
  await app.keyboard.press('Escape');

  await folderButton(app, FOLDER).click({ button: 'right' });
  const share = app.getByRole('menuitem', { name: 'Share folder…' });
  await expect(share).toBeVisible();
  await shot(app, 'share-folder-menu', DESKTOP.width);
  await share.click();

  // Private state: the explanation, the link preview and a Share folder button.
  const dialog = app.getByRole('dialog', { name: 'Share Folder' });
  await expect(dialog).toContainText('Private');
  await expect(dialog).toContainText('2 notes in this folder will become public, and new notes in this folder start public');
  await expect(dialog.getByText(FOLDER, { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Notes in the folder Blog by .+, shared with Journal/)).toBeVisible();
  await shot(app, 'share-folder-dialog-private', DESKTOP.width);
  await dialog.getByRole('button', { name: 'Share folder', exact: true }).click();

  // The dialog turns into the shared state in place, with the link and the same preview.
  const link = dialog.getByRole('textbox', { name: 'Folder link' });
  await expect(link).toHaveValue(/\/share\/[^/]+\/f\/[0-9a-f-]{36}$/);
  await expect(dialog.getByRole('button', { name: 'Open in New Tab' })).toBeVisible();
  await expect(dialog.getByText(/Notes in the folder Blog by .+, shared with Journal/)).toBeVisible();
  await expect(app.getByText('Folder shared. 2 notes made public.')).toBeVisible();
  await shot(app, 'share-folder-dialog-shared', DESKTOP.width);

  // Copy puts the folder URL on the clipboard; Open in New Tab opens it.
  await app.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await dialog.getByRole('button', { name: 'Copy link' }).click();
  expect(await app.evaluate(() => navigator.clipboard.readText())).toBe(await link.inputValue());
  const popup = app.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Open in New Tab' }).click();
  expect((await popup).url()).toBe(await link.inputValue());
  await (await popup).close();
  await app.keyboard.press('Escape');
  await expect(folderButton(app, FOLDER)).toHaveAttribute('aria-description', 'Shared publicly');
  await expect(publicBadge(app, 'First post')).toHaveCount(1);
  await expect(publicBadge(app, 'Second post')).toHaveCount(1);
  await shot(app, 'shared-folder-indicator', DESKTOP.width);

  // The live rule: a note created in the shared folder starts public...
  await createNote(app, { title: 'Third post', body: 'New' });
  await expect(publicBadge(app, 'Third post')).toHaveCount(1);
  // ...and one created in a private folder stays private.
  await selectFolder(app, 'Main');
  await createNote(app, { title: 'Private thought', body: 'Mine' });
  await expect(publicBadge(app, 'Private thought')).toHaveCount(0);
  await expect(folderButton(app, 'Main')).not.toHaveAttribute('aria-description');

  await folderButton(app, FOLDER).click({ button: 'right' });
  await expect(app.getByRole('menuitem', { name: 'Share folder…' })).toBeVisible();
  await app.keyboard.press('Escape');

  // The flag survives a reload. Forget the last note so the phone-sized cold start stays
  // on the sidebar instead of session restore reopening it.
  await waitForNoteSaved(app);
  await assertTestOrigin(app);
  await app.evaluate(() => localStorage.removeItem('journal-session-state'));
  await app.setViewportSize(MOBILE);
  await app.goto('/');
  await waitForAppReady(app);
  await shot(app, 'shared-folder-indicator', MOBILE.width);

  await folderButton(app, FOLDER).click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Share folder…' }).click();
  await shot(app, 'share-folder-dialog-shared', MOBILE.width);
  await app.getByRole('dialog', { name: 'Share Folder' }).getByRole('button', { name: 'Stop sharing (make private)' }).click();

  const confirm = app.getByRole('dialog', { name: 'Stop sharing folder?' });
  await expect(confirm).toContainText('3 notes will become private');
  await shot(app, 'stop-sharing-folder-confirm', MOBILE.width);
  await confirm.getByRole('button', { name: 'Stop sharing', exact: true }).click();

  await expect(app.getByText('Folder is private again. 3 notes made private.')).toBeVisible();
  // Back to Private in the same dialog.
  const again = app.getByRole('dialog', { name: 'Share Folder' });
  await expect(again.getByRole('button', { name: 'Share folder', exact: true })).toBeVisible();
  // Counted after the notes went private, not before.
  await expect(again).toContainText('3 notes in this folder will become public');
  await shot(app, 'share-folder-dialog-private', MOBILE.width);
  await app.keyboard.press('Escape');
  await expect(folderButton(app, FOLDER)).not.toHaveAttribute('aria-description');

  await selectFolder(app, FOLDER);
  await expect(app.getByTestId('note-row')).toHaveCount(3);
  await expect(app.getByTestId('note-row').locator('svg.lucide-globe')).toHaveCount(0);
});

// #644: the dialog previews the folder's own 1200x630 link card (drawn in the browser,
// so a blob: URL), not the site banner, and draws it again when the folder is renamed.
test('the Share folder dialog previews the folder card and redraws it after a rename', async ({ app }) => {
  await app.setViewportSize(DESKTOP);
  await createFolder(app, 'Cards');
  await selectFolder(app, 'Cards');
  await createNote(app, { title: 'One', body: 'Hello' });

  const openShare = async (name: string) => {
    await folderButton(app, name).click({ button: 'right' });
    await app.getByRole('menuitem', { name: 'Share folder…' }).click();
    return app.getByRole('dialog', { name: 'Share Folder' });
  };

  const before = await openShare('Cards');
  const card = before.locator('img[src^="blob:"]');
  await expect(card).toHaveCount(1);
  await expect(before.locator('img[src="/banner.webp"]')).toHaveCount(0);
  await app.screenshot({ path: test.info().outputPath('folder-card-preview-light-1280.png'), animations: 'disabled' });
  const firstSrc = await card.getAttribute('src');
  await app.keyboard.press('Escape');

  await folderButton(app, 'Cards').click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Rename Folder' }).click();
  const input = app.getByRole('dialog').getByPlaceholder('Folder Name');
  await input.fill('Renamed cards');
  await input.press('Enter');

  const after = await openShare('Renamed cards');
  await expect(after.locator('img[src^="blob:"]')).toHaveCount(1);
  expect(await after.locator('img[src^="blob:"]').getAttribute('src')).not.toBe(firstSrc);
});
