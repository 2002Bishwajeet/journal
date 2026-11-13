import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { activeTitleInput, inBothThemes, pasteHtml, typeInEditor, waitForNoteSaved } from '../support/actions';

// On a phone, a body match opens the note with Find on the word, under the note header (#1227).

test('picking a body match in Search opens the note with Find on the word', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.getByRole('complementary', { name: 'Sidebar' }).getByText('Main', { exact: true }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const title = activeTitleInput(page);
    await expect(title).toHaveValue('Untitled');
    await title.fill('Long note');
    await typeInEditor(page, 'start');
    await pasteHtml(
      page,
      Array.from({ length: 60 }, (_, i) => `<p>Filler paragraph number ${i + 1} with some ordinary words.</p>`).join('') +
        '<p>The zorbleflux sits at the very end.</p>',
    );
    await waitForNoteSaved(page);

    // Back to the note list, then back to the sidebar.
    const search = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /Search/ });
    for (let i = 0; i < 2 && !(await search.isVisible()); i++) {
      await page.getByRole('button', { name: /^Back/ }).first().click();
    }
    await search.click();
    const dialog = page.getByRole('dialog', { name: 'Search notes' });
    await dialog.getByPlaceholder('Search notes...').fill('zorbleflux');
    await dialog.getByText('Long note').click();
    await expect(dialog).toBeHidden();

    const find = page.getByRole('textbox', { name: 'Find in note' });
    await expect(find).toHaveValue('zorbleflux');
    await expect(page.getByRole('search').getByText('1 of 1')).toBeVisible();
    const match = page.locator('.search-highlight-current:visible');
    await expect(match).toBeInViewport();

    await inBothThemes(page, async (theme) => {
      await page.screenshot({ path: test.info().outputPath(`search-jump-${theme}-393x852.png`) });
    });

    // Back returns to the screen under the sheet, and the bar stays closed on the way.
    await page.getByRole('button', { name: /^Back/ }).first().click();
    await expect(find).toBeHidden();
  });
});
