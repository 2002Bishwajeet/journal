import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, foldersNav, typeInEditor } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// On a phone: Archive from the note's More sheet, the note is listed in Archive,
// Back never strands you on "Looking for this note…", and once unarchived the
// note opens with its content. The editor opens only active notes.

const pathOf = (page: Page) => new URL(page.url()).pathname;
const archivedRow = (page: Page, title: string) => page.getByTestId('hidden-note-row').filter({ hasText: title });

test('archive a note, find it in Archive, unarchive it and open it again', async ({ browser }) => {
  test.setTimeout(60_000);
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
    await page.getByRole('button', { name: 'New note', exact: true }).tap();
    await expect(activeTitleInput(page)).toBeVisible();
    const title = `Archived ${Date.now()}`;
    await activeTitleInput(page).fill(title);
    await typeInEditor(page, 'Kept in the archive');
    const notePath = pathOf(page);

    await page.getByRole('button', { name: 'More', exact: true }).tap();
    await page.getByRole('dialog', { name: title, exact: true }).getByRole('menuitem', { name: 'Archive', exact: true }).tap();
    await expect.poll(() => pathOf(page)).not.toBe(notePath);

    // Back leaves the archived note behind: it never reopens it, spins, or says "not found".
    await page.goBack();
    await expect.poll(() => pathOf(page)).not.toBe(notePath);
    await expect(page.getByText('Note not found')).toHaveCount(0);
    await expect(page.getByText('Looking for this note…')).toHaveCount(0);
    await expect.poll(() => pathOf(page)).toBe('/');
    await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Archive/ }).tap();
    await expect(archivedRow(page, title)).toBeVisible();
    await archivedRow(page, title).click({ button: 'right' });
    await page.getByRole('menu').getByRole('menuitem', { name: 'Unarchive note' }).tap();
    await expect(archivedRow(page, title)).toHaveCount(0);

    await page.getByRole('button', { name: 'Back to notes' }).tap();
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
    await page.getByTestId('note-row').filter({ hasText: title }).tap();
    await expect(activeEditor(page)).toContainText('Kept in the archive');
  });
});
