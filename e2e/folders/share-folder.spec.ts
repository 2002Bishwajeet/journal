import { test, expect, waitForAppReady } from '../fixtures';
import type { Page } from '@playwright/test';
import { createFolder, createNote, foldersNav, inBothThemes, selectFolder, waitForNoteSaved } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #618: Share folder / Stop sharing folder in a folder's context menu. Backend-free:
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
  await expect(app.getByRole('menuitem', { name: /sharing folder|Share folder/ })).toHaveCount(0);
  await app.keyboard.press('Escape');

  await folderButton(app, FOLDER).click({ button: 'right' });
  const share = app.getByRole('menuitem', { name: 'Share folder' });
  await expect(share).toBeVisible();
  await shot(app, 'share-folder-menu', DESKTOP.width);
  await share.click();

  await expect(app.getByText('Folder shared. 2 notes made public.')).toBeVisible();
  await expect(folderButton(app, FOLDER)).toHaveAttribute('aria-description', 'Shared publicly');
  await expect(publicBadge(app, 'First post')).toHaveCount(1);
  await expect(publicBadge(app, 'Second post')).toHaveCount(1);
  await shot(app, 'shared-folder-indicator', DESKTOP.width);

  // #619: a shared folder shows its public page link, with copy and open buttons.
  await folderButton(app, FOLDER).click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Folder link' }).click();
  const linkDialog = app.getByRole('dialog', { name: 'Folder link' });
  await expect(linkDialog.getByRole('textbox', { name: 'Folder link' })).toHaveValue(/\/share\/[^/]+\/f\/[0-9a-f-]{36}$/);
  await expect(linkDialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(linkDialog.getByRole('button', { name: 'Open in New Tab' })).toBeVisible();
  await shot(app, 'folder-link-dialog', DESKTOP.width);
  await app.keyboard.press('Escape');

  // The live rule: a note created in the shared folder starts public...
  await createNote(app, { title: 'Third post', body: 'New' });
  await expect(publicBadge(app, 'Third post')).toHaveCount(1);
  // ...and one created in a private folder stays private.
  await selectFolder(app, 'Main');
  await createNote(app, { title: 'Private thought', body: 'Mine' });
  await expect(publicBadge(app, 'Private thought')).toHaveCount(0);
  await expect(folderButton(app, 'Main')).not.toHaveAttribute('aria-description');

  await folderButton(app, FOLDER).click({ button: 'right' });
  await expect(app.getByRole('menuitem', { name: 'Stop sharing folder' })).toBeVisible();
  await shot(app, 'stop-sharing-folder-menu', DESKTOP.width);
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
  await expect(app.getByRole('menuitem', { name: 'Stop sharing folder' })).toBeVisible();
  await shot(app, 'stop-sharing-folder-menu', MOBILE.width);
  await app.getByRole('menuitem', { name: 'Folder link' }).click();
  await shot(app, 'folder-link-dialog', MOBILE.width);
  await app.keyboard.press('Escape');
  await folderButton(app, FOLDER).click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Stop sharing folder' }).click();

  const dialog = app.getByRole('dialog');
  await expect(dialog).toContainText('3 notes will become private');
  await shot(app, 'stop-sharing-folder-confirm', MOBILE.width);
  await dialog.getByRole('button', { name: 'Stop sharing', exact: true }).click();

  await expect(app.getByText('Folder is private again. 3 notes made private.')).toBeVisible();
  await expect(folderButton(app, FOLDER)).not.toHaveAttribute('aria-description');
  await folderButton(app, FOLDER).click({ button: 'right' });
  await expect(app.getByRole('menuitem', { name: 'Share folder' })).toBeVisible();
  await app.keyboard.press('Escape');

  await selectFolder(app, FOLDER);
  await expect(app.getByTestId('note-row')).toHaveCount(3);
  await expect(app.getByTestId('note-row').locator('svg.lucide-globe')).toHaveCount(0);
});
