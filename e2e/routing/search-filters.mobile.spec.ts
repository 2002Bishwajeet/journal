import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { inBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// On a phone, the search sheet's Tag button starts a tag filter, and a tap on a suggestion applies it (#1230).

test('tap Tag, pick a tag, and see its notes', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await assertTestOrigin(page);
    // Travel 1-3 in Travel and Work 1-3 in Work; Travel 3 and Work 3 have the tags "work" and "ideas".
    await page.evaluate(() => window.__journalE2E!.seedFolders([{ name: 'Travel', count: 3 }, { name: 'Work', count: 3 }]));

    await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /Search/ }).tap();
    const dialog = page.getByRole('dialog', { name: 'Search notes' });
    await expect(dialog).toBeVisible();
    await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const input = dialog.getByPlaceholder('Search notes...');
    const notes = dialog.locator('[id^="search-result-"]').filter({ hasText: 'Body of' });

    const buttons = ['Folder', 'Tag', 'Date', 'Pinned'].map((name) => dialog.getByRole('button', { name, exact: true }));
    for (const button of buttons) {
      await expect(button).toBeVisible();
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await buttons[1].tap();
    await expect(input).toHaveValue('tag:');
    await expect(input).toBeFocused();
    const work = dialog.getByRole('option', { name: /^#work/ });
    await expect(work).toBeVisible();
    await expect(dialog.getByRole('option', { name: /^#ideas/ })).toBeVisible();
    await inBothThemes(page, async (theme) => {
      await page.screenshot({ path: test.info().outputPath(`search-filter-suggestions-${theme}-393x852.png`) });
    });

    await work.tap();
    await expect(input).toHaveValue('tag:work ');
    await expect(notes).toHaveCount(2);
    await expect(notes.filter({ hasText: 'Travel 3' })).toHaveCount(1);
    await expect(notes.filter({ hasText: 'Work 3' })).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: 'Remove filter #work' })).toBeVisible();
    await inBothThemes(page, async (theme) => {
      await page.screenshot({ path: test.info().outputPath(`search-filter-results-${theme}-393x852.png`) });
    });
  });
});
