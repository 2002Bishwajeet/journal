import { test, expect } from '../fixtures';
import { createNote, pasteHtml, screenshotInBothThemes, waitForNoteSaved } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// On a phone the Find bar sits under the note header, in view whatever the scroll position (#1419).

test('Find stays in view at the bottom of a long note', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await createNote(page, { title: 'Long note', body: 'start' });
    await pasteHtml(
      page,
      Array.from({ length: 80 }, (_, i) => `<p>Filler paragraph ${i + 1} with words${i % 10 === 0 ? ' zorbleflux' : ''}.</p>`).join(''),
    );
    await waitForNoteSaved(page);

    const scroller = page.locator('[data-note-scroller]:visible');
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.keyboard.press('ControlOrMeta+f');
    const find = page.getByRole('textbox', { name: 'Find in note' });
    await expect(find).toBeVisible();

    const check = async () => {
      const pane = (await scroller.boundingBox())!;
      const bar = (await page.getByRole('search').boundingBox())!;
      expect(bar.y).toBeGreaterThanOrEqual(pane.y - 1);
      expect(bar.y + bar.height).toBeLessThanOrEqual(pane.y + pane.height + 1);
    };
    await check();
    await find.fill('zorbleflux');
    await page.keyboard.press('Enter');
    await check();

    await screenshotInBothThemes(page, (theme) => `find-bar-pinned-${theme}-390.png`);
  });
});
