import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withTabletPage } from '../support/mobile';
import { createFolder, selectFolder, THEMES } from '../support/actions';

// On an iPad in portrait the note list and the open note sit side by side; the
// folders open as an overlay from the list header (#832).

const FOLDER = 'Tablet folder';
const OTHER = 'Tablet other';
const portrait = { width: 820, height: 1180 };
const landscape = { width: 1180, height: 820 };

const listPane = (page: Page) => page.locator('[data-pane="note-list"]');
const sidebarPane = (page: Page) => page.locator('[data-pane="sidebar"]');
const showFolders = (page: Page) => page.getByRole('button', { name: 'Show folders', exact: true });
const rows = (page: Page) => page.getByTestId('note-row');

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

async function shots(page: Page, name: string) {
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await page.waitForTimeout(400);
    await page.screenshot({ path: test.info().outputPath(`${name}-${theme}-${page.viewportSize()!.width}x${page.viewportSize()!.height}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('the list and the note sit side by side, and the folders open as an overlay', async ({ browser }) => {
  await withTabletPage(browser, landscape, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // Landscape has the desktop sidebar, so make the folders there, then turn the iPad upright.
    await createFolder(page, FOLDER);
    await createFolder(page, OTHER);
    await page.setViewportSize(portrait);

    // The sidebar is an overlay on a tablet: nothing shows until the list header asks for it.
    await expect(sidebarPane(page)).toBeHidden();
    await expect(showFolders(page)).toBeVisible();
    await showFolders(page).click();
    await expect(sidebarPane(page)).toBeVisible();
    await shots(page, 'folders-overlay');

    // Back closes it and stays on the same screen.
    const before = page.url();
    await page.goBack();
    await expect(sidebarPane(page)).toBeHidden();
    expect(page.url()).toBe(before);

    // Tap outside closes it.
    await showFolders(page).click();
    await expect(sidebarPane(page)).toBeVisible();
    await page.getByRole('button', { name: 'Close folders' }).click({ position: { x: 780, y: 600 } });
    await expect(sidebarPane(page)).toBeHidden();

    // Choosing a folder closes it, and the list shows that folder beside an empty editor.
    await showFolders(page).click();
    await selectFolder(page, FOLDER);
    await expect(sidebarPane(page)).toBeHidden();
    await expect(page.getByRole('heading', { name: FOLDER })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start Writing' })).toBeVisible();
    await shots(page, 'folder-empty-editor');

    // After a note opens, both panes show.
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.locator('.tiptap').first()).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
    const list = await box(listPane(page));
    const editor = await box(page.locator('#main-content'));
    expect(list.width).toBeCloseTo(320, 0);
    expect(editor.x).toBeGreaterThanOrEqual(list.x + list.width - 1);
    expect(editor.width).toBeGreaterThan(400);
    await expect(page.getByRole('button', { name: /^Back to (?!notes$)/ })).toBeHidden();
    await shots(page, 'two-pane');

    // Tapping another note row keeps both panes.
    await rows(page).first().click();
    await expect(listPane(page)).toBeVisible();
    await expect(page.locator('.tiptap').first()).toBeVisible();
  });
});

test('landscape keeps the desktop layout', async ({ browser }) => {
  await withTabletPage(browser, landscape, async (page) => {
    await expect(sidebarPane(page)).toBeVisible();
    await expect(showFolders(page)).toHaveCount(0);
    await shots(page, 'desktop');
  });
});
