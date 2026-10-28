import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { activeTitleInput, typeInEditor, waitForNoteSaved, inBothThemes } from '../support/actions';

// On a phone, Search is a full-screen sheet with a Cancel button (#780).

const openSearch = async (page: Page) => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /Search/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Search notes' });
  await expect(dialog).toBeVisible();
  return dialog;
};

test('search fills the screen, has a tall Cancel button, and opens a result', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.getByRole('complementary', { name: 'Sidebar' }).getByText('Main', { exact: true }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const title = activeTitleInput(page);
    await expect(title).toHaveValue('Untitled');
    await title.fill('Zebra crossing');
    await typeInEditor(page, 'Stripes on the road');
    await waitForNoteSaved(page);
    // Back to the note list, then back to the sidebar.
    const search = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /Search/ });
    for (let i = 0; i < 2 && !(await search.isVisible()); i++) {
      await page.getByRole('button', { name: /^Back/ }).first().click();
    }

    let dialog = await openSearch(page);
    // Measure after the 200ms zoom-in, which scales the sheet to 95% at first.
    await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = await dialog.boundingBox();
    expect(box!.x).toBe(0);
    expect(box!.y).toBe(0);
    expect(box!.width).toBe(393);
    expect(box!.height).toBe(852);

    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeVisible();
    expect((await cancel.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    const input = dialog.getByPlaceholder('Search notes...');
    await inBothThemes(page, async (theme) => {
      await input.fill('');
      await page.screenshot({ path: test.info().outputPath(`search-empty-${theme}-393x852.png`) });
      await input.fill('Zebra');
      await expect(dialog.getByText('Zebra crossing')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`search-results-${theme}-393x852.png`) });
      await input.fill('qqqxyz');
      await expect(dialog.getByText('No notes found')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`search-none-${theme}-393x852.png`) });
    });

    await cancel.click();
    await expect(dialog).toBeHidden();

    dialog = await openSearch(page);
    await dialog.getByPlaceholder('Search notes...').fill('Zebra');
    await dialog.getByText('Zebra crossing').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: /^Back to (?!notes$)/ })).toBeVisible();
    await expect(page.locator('textarea[placeholder="Untitled"]:visible')).toHaveValue('Zebra crossing');
  });
});
