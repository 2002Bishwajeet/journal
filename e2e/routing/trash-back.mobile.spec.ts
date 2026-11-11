import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeTitleInput, foldersNav, typeInEditor } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// On a phone, Back from the folder list after Move to Trash must not reopen the
// trashed note on an endless "Looking for this note…" with no way out
// (#111 iPhone test, https://github.com/2002Bishwajeet/journal/pull/111#issuecomment-6789944970).

const pathOf = (page: Page) => new URL(page.url()).pathname;

test('Move to Trash, then Back, goes back past the trashed note', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
    const folderPath = pathOf(page);
    await page.getByRole('button', { name: 'New note', exact: true }).tap();
    await expect(activeTitleInput(page)).toBeVisible();
    const title = `Trash back ${Date.now()}`;
    await activeTitleInput(page).fill(title);
    await typeInEditor(page, 'Going to Trash');
    const notePath = pathOf(page);

    await page.getByRole('button', { name: 'More', exact: true }).tap();
    await page.getByRole('dialog', { name: title, exact: true }).getByRole('menuitem', { name: 'Move to Trash' }).tap();
    await page.getByRole('dialog', { name: 'Move to Trash?' }).getByRole('button', { name: 'Move to Trash' }).tap();
    await expect.poll(() => pathOf(page)).toBe(folderPath);
    await expect(page.getByTestId('note-row').filter({ hasText: title })).toHaveCount(0);

    // The folder list's Back goes to the sidebar, not to the trashed note.
    await page.getByRole('button', { name: 'Back to notes', exact: true }).tap();
    await expect.poll(() => pathOf(page)).not.toBe(notePath);
    await expect.poll(() => pathOf(page)).toBe('/');
    await expect(page.getByText('Looking for this note…')).toHaveCount(0);
  });
});
