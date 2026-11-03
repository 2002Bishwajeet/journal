import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { activeTitleInput, typeInEditor, waitForNoteSaved, inBothThemes } from '../support/actions';

// On a phone, the search sheet lists recent notes too (#820).

test('the search sheet shows a recent note and opens it', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.getByRole('complementary', { name: 'Sidebar' }).getByText('Main', { exact: true }).click();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const title = activeTitleInput(page);
    await expect(title).toHaveValue('Untitled');
    await title.fill('Zebra crossing');
    await typeInEditor(page, 'Stripes on the road');
    await waitForNoteSaved(page);
    const search = page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /Search/ });
    for (let i = 0; i < 2 && !(await search.isVisible()); i++) {
      await page.getByRole('button', { name: /^Back/ }).first().click();
    }

    await search.click();
    const dialog = page.getByRole('dialog', { name: 'Search notes' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Recent', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Remove from recent' })).toBeVisible();
    await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    await inBothThemes(page, async (theme) => {
      await page.screenshot({ path: test.info().outputPath(`search-recent-${theme}-393x852.png`) });
    });

    await dialog.getByText('Zebra crossing').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('textarea[placeholder="Untitled"]:visible')).toHaveValue('Zebra crossing');
  });
});
