import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { activeTitleInput, createFolder, selectFolder, typeInEditor } from '../support/actions';

// Each tab of the phone tab bar keeps its own back stack (#859): switching rebuilds the
// browser history from the target tab's screens, so Back walks that tab's own screens.
// Back from a tab's first screen still goes to the previous browser entry.

const PROJECTS = 'Projects';
const tabBar = (page: Page) => page.getByRole('navigation', { name: 'Tabs' });
const tab = (page: Page, name: string) => tabBar(page).getByRole('button', { name, exact: true });
// The route, without the app's /app (#913).
const pathOf = (page: Page) => new URL(page.url()).pathname.replace(/^\/app/, '');
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });
const savedStack = (page: Page, name: 'notes' | 'shared') =>
  page.evaluate((n) => (JSON.parse(sessionStorage.getItem('journal-tab-stacks') ?? '{}') as Record<string, string[]>)[n], name);

/** A folder with a note in it; leaves the page on the note. Returns the folder's and the note's paths. */
async function folderWithNote(page: Page) {
  await createFolder(page, PROJECTS);
  await selectFolder(page, PROJECTS);
  await expect(page.getByRole('heading', { name: PROJECTS })).toBeVisible();
  const folder = pathOf(page);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await expect.poll(() => pathOf(page)).not.toBe(folder);
  await expect(activeTitleInput(page)).toHaveValue('Untitled');
  await activeTitleInput(page).fill(`Stack ${Date.now()}`);
  await typeInEditor(page, 'Body.');
  return { folder, note: pathOf(page) };
}

test('Notes keeps its screens across a visit to Shared, and Back walks them', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { folder, note } = await folderWithNote(page);
    expect(await savedStack(page, 'notes')).toEqual(['/', folder, note]);

    // The bar is hidden inside a note: go back to the folder list, where it shows.
    await page.getByRole('button', { name: /^Back to (?!notes$)/ }).click();
    await expect.poll(() => pathOf(page)).toBe(folder);

    await tab(page, 'Shared').click();
    await expect.poll(() => pathOf(page)).toBe('/shared');
    await expect(tab(page, 'Shared')).toHaveAttribute('aria-current', 'page');

    await tab(page, 'Notes').click();
    await expect.poll(() => pathOf(page)).toBe(folder);
    await expect(page.getByRole('heading', { name: PROJECTS })).toBeVisible();

    // Back goes to the Notes root, not to Shared.
    await page.goBack();
    await expect.poll(() => pathOf(page)).toBe('/');
    await expect(sidebar(page)).toBeVisible();
    await expect(tab(page, 'Notes')).toHaveAttribute('aria-current', 'page');
    expect(await savedStack(page, 'notes')).toEqual(['/']);
  });
});

test('tapping the active Notes tab returns to its root and clears its stack', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createFolder(page, PROJECTS);
    await selectFolder(page, PROJECTS);
    await expect(page.getByRole('heading', { name: PROJECTS })).toBeVisible();
    expect((await savedStack(page, 'notes'))?.length).toBe(2);

    await tab(page, 'Notes').click();
    await expect.poll(() => pathOf(page)).toBe('/');
    await expect(sidebar(page)).toBeVisible();
    expect(await savedStack(page, 'notes')).toEqual(['/']);

    // A tab switch now rebuilds from the root only.
    await tab(page, 'Shared').click();
    await tab(page, 'Notes').click();
    await expect.poll(() => pathOf(page)).toBe('/');
  });
});

test('a reload in the middle of the stack keeps it, and Back still walks it', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { folder, note } = await folderWithNote(page);

    await page.reload();
    await expect(activeTitleInput(page)).toBeVisible({ timeout: 30_000 });
    expect(pathOf(page)).toBe(note);
    expect(await savedStack(page, 'notes')).toEqual(['/', folder, note]);

    await page.goBack();
    await expect.poll(() => pathOf(page)).toBe(folder);
    expect(await savedStack(page, 'notes')).toEqual(['/', folder]);
    await page.goBack();
    await expect.poll(() => pathOf(page)).toBe('/');
    expect(await savedStack(page, 'notes')).toEqual(['/']);
  });
});
