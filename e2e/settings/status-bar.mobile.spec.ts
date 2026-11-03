import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createFolder, foldersNav, inBothThemes, screenshotInBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// On an iPhone the installed app's status bar takes the colour of the fixed layer at the top
// of the page. Under Settings and the full sheets that layer was the dialog's dim backdrop,
// so the status bar was a grey band (black/50 over the page) above a light sheet. A
// full-screen surface covers the page and needs no dim: its backdrop is transparent, so the
// status bar takes the surface's own colour. Chromium paints no status bar, so this checks
// the backdrop's computed colour.

const animationsDone = (page: Page) => page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));

async function expectNoBand(page: Page, name: string, slug: string) {
  await expect(page.getByRole('dialog', { name })).toBeVisible();
  await animationsDone(page);
  await inBothThemes(page, async () => {
    const backdrop = page.locator('[data-slot=dialog-overlay]');
    await expect(backdrop).toHaveCount(1);
    expect(await backdrop.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  });
  await screenshotInBothThemes(page, (theme) => `${slug}-${theme}-390.png`, undefined, { animations: 'disabled' });
}

test('Settings on a phone has no dim band behind the status bar', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('navigation', { name: 'Tabs' }).getByRole('button', { name: 'Settings' }).click();
    await expectNoBand(page, 'Settings', 'settings');
  });
});

test('a full sheet (Share Folder) has no dim band behind the status bar', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await createFolder(page, 'Trips');
    const folder = foldersNav(page).getByRole('button', { name: 'Trips', exact: true });
    const box = (await folder.boundingBox())!;
    await page.mouse.click(box.x + 24, box.y + box.height / 2, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Share folder…' }).click();
    await expectNoBand(page, 'Share Folder', 'share-folder');
  });
});
