import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { activeTitleInput, createNote, selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { withMobilePage } from '../support/mobile';

// On a phone the system Back and the app's Back agree, and Back closes a
// dialog or sheet instead of changing the screen under it (#822).

const pathOf = (page: Page) => new URL(page.url()).pathname;
const historyIdx = (page: Page) => page.evaluate(() => (history.state as { idx?: number } | null)?.idx ?? 0);

async function newNoteInMain(page: Page, title: string) {
  await selectFolder(page, 'Main');
  await createNote(page, { title, body: 'Body.' });
}

test('in-app Back pops the entry, so system Back returns to the sidebar', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await newNoteInMain(page, `Back pop ${Date.now()}`);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Main' }).first()).toBeVisible();
    await page.goBack();
    await expect.poll(() => pathOf(page)).toBe('/');
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
  });
});

test('Back from a deep-linked note replaces with the folder list', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await newNoteInMain(page, `Back deep ${Date.now()}`);
    const noteUrl = page.url();
    await page.evaluate(() => localStorage.removeItem('journal-session-state'));
    await page.goto(noteUrl);
    await assertTestOrigin(page);
    await waitForAppReady(page);
    await expect(activeTitleInput(page)).toBeVisible();
    expect(await historyIdx(page)).toBe(0);

    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect.poll(() => pathOf(page)).toBe(new URL(noteUrl).pathname.split('/').slice(0, 2).join('/'));
    expect(await historyIdx(page)).toBe(0);
  });
});

test('system Back closes Move to folder and Share without changing the URL', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const title = `Back dialogs ${Date.now()}`;
    await newNoteInMain(page, title);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    const listUrl = page.url();

    for (const [item, dialog] of [
      ['Move to folder…', 'Move to folder'],
      ['Share', 'Share'],
    ] as const) {
      await page.getByTestId('note-row').filter({ hasText: title }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: item }).click();
      await expect(page.getByRole('dialog')).toContainText(dialog);
      await page.goBack();
      await expect(page.getByRole('dialog')).toBeHidden();
      expect(page.url()).toBe(listUrl);
    }
  });
});

test('system Back closes Settings and stays on the same screen', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const before = page.url();
    await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /Settings/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(page.url()).toBe(before);
  });
});

test('system Back closes Version history and keeps the note open', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    const title = `Back history ${Date.now()}`;
    await newNoteInMain(page, title);
    const noteUrl = page.url();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Version history' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(page.url()).toBe(noteUrl);
    await expect(activeTitleInput(page)).toHaveValue(title);
  });
});

test('a dialog closed with its X leaves no stale history entry', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /Settings/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    // Open a folder, then Back: the sidebar, not a leftover Settings entry.
    await selectFolder(page, 'Main');
    await page.goBack();
    await expect.poll(() => pathOf(page)).toBe('/');
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
