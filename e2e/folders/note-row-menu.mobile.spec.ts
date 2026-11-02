import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { foldersNav, screenshotInBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #784: a long press on a note row opens its actions in a bottom sheet that is fully
// on screen, with touch-sized rows and no keyboard hints.

const viewport = { width: 393, height: 852 };

test('a long press in the middle of a note row opens a sheet that is fully on screen', async ({ browser }) => {
  await withMobilePage(browser, async (page: Page) => {
    await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
    await page.getByRole('button', { name: 'New note', exact: true }).tap();
    await page.getByRole('button', { name: /^Back to (?!notes$)/ }).tap();
    const row = page.locator('[data-testid=note-row]:visible').first();
    await expect(row).toBeVisible();
    const box = (await row.boundingBox())!;
    // Radix opens the context menu at the point a long press (contextmenu) fires; the
    // middle of the row used to leave too little room on either side for the menu's width.
    await row.click({ button: 'right', position: { x: box.width / 2, y: box.height / 2 } });

    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Move to Trash' })).toBeVisible();
    await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const items = menu.getByRole('menuitem');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const item = (await items.nth(i).boundingBox())!;
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.x + item.width).toBeLessThanOrEqual(viewport.width);
      expect(item.height).toBeGreaterThanOrEqual(44);
    }
    await expect(menu.getByText('⌫')).toHaveCount(0);
    await screenshotInBothThemes(page, (theme) => `note-row-actions-${theme}-393x852.png`);

    await menu.getByRole('menuitem', { name: 'Move to Trash' }).tap();
    await expect(page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: /trash/i })).toBeVisible();
  });
});
