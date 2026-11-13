import { test, expect } from '../fixtures';
import { foldersNav } from '../support/actions';
import { withMobilePage } from '../support/mobile';
import { NOTE_FOLDER, measureOpen, reportOpens, setUpNoteOpen, type OpenSample } from '../support/noteOpen';

// On a phone a tap on a note row slides to the note at once.

test('tapping a note in a 100-note list on a phone opens it without a delay', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP metrics are Chromium only');
  test.setTimeout(120_000);
  await withMobilePage(browser, async (page) => {
    const cdp = await setUpNoteOpen(page);
    await foldersNav(page).getByRole('button', { name: NOTE_FOLDER.name, exact: true }).tap();
    const list = page.locator('[data-pane="note-list"]');
    const samples: OpenSample[] = [];
    for (let i = 2; i <= 8; i++) {
      const title = `${NOTE_FOLDER.name} ${i}`;
      const row = list.getByTestId('note-row').filter({ has: page.getByText(title, { exact: true }) });
      await expect(row).toBeVisible();
      samples.push(await measureOpen(page, cdp, row, title, 'tap'));
      await page.goBack();
    }
    await reportOpens(samples, 'note-open-mobile.json');
  });
});
