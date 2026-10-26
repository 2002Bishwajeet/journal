import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createFolder, foldersNav, screenshotInBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #777: on a phone the folder and note menus open from a visible "options" button,
// stay inside the screen, and have touch-sized items.

const viewport = { width: 393, height: 852 };

async function expectTouchSizedAndOnScreen(menu: Locator) {
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  const items = menu.getByRole('menuitem');
  const count = await items.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    // The menu zooms in when it opens, so wait for it to reach full size.
    await expect.poll(async () => (await items.nth(i).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
}

test('the folder options button opens the folder menu and Rename shows the name', async ({ browser }) => {
  await withMobilePage(browser, async (page: Page) => {
    await createFolder(page, 'Trips');
    const row = foldersNav(page).locator('div.flex', { has: page.getByRole('button', { name: 'Trips', exact: true }) }).last();
    const options = row.getByRole('button', { name: 'Folder options' });
    await expect(options).toBeVisible();
    const optionsBox = (await options.boundingBox())!;
    expect(optionsBox.width).toBeGreaterThanOrEqual(44);
    // Inside the screen without scrolling: a row that overflows pushes the button off the right edge.
    expect(optionsBox.x + optionsBox.width).toBeLessThanOrEqual(viewport.width);

    await options.tap();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Rename Folder' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Share folder…' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Delete Folder' })).toBeVisible();
    await expectTouchSizedAndOnScreen(menu);
    await screenshotInBothThemes(page, (theme) => `folder-menu-${theme}-393x852.png`);

    await menu.getByRole('menuitem', { name: 'Rename Folder' }).tap();
    await expect(page.getByRole('dialog').getByPlaceholder('Folder Name')).toHaveValue('Trips');
  });
});

test('the note options button opens a menu that is fully on screen', async ({ browser }) => {
  await withMobilePage(browser, async (page: Page) => {
    // On a phone the sidebar is the whole screen: open a folder to reach the note list.
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
    await page.getByRole('button', { name: 'New note', exact: true }).tap();
    await page.getByRole('button', { name: 'Back', exact: true }).tap();
    const row = page.locator('[data-testid=note-row]:visible').first();
    await expect(row).toBeVisible();
    const options = row.getByRole('button', { name: 'Note options', exact: true });
    await expect(options).toBeVisible();
    const optionsBox = (await options.boundingBox())!;
    expect(optionsBox.x + optionsBox.width).toBeLessThanOrEqual(viewport.width);

    await options.tap();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Move to Trash' })).toBeVisible();
    await expect(menu.getByText('⌫')).toHaveCount(0);
    await expectTouchSizedAndOnScreen(menu);
    await screenshotInBothThemes(page, (theme) => `note-menu-${theme}-393x852.png`);
  });
});

test('a long press in the middle of a folder row opens a menu that is fully on screen', async ({ browser }) => {
  await withMobilePage(browser, async (page: Page) => {
    await createFolder(page, 'Trips');
    const folder = foldersNav(page).getByRole('button', { name: 'Trips', exact: true });
    const box = (await folder.boundingBox())!;
    // Radix opens the context menu at the point a long press (contextmenu) fires; the
    // middle of the row leaves too little room on either side for the menu's width.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Delete Folder' })).toBeVisible();
    await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await expectTouchSizedAndOnScreen(menu);
  });
});
