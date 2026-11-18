import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, screenshotInBothThemes } from '../support/actions';
import { lineCount } from '../support/tableLines';

// #1384: a table whose cells hold long bare URLs fits the note column, every column
// stays visible, the URLs wrap inside their cells, and a multi-word cell does not wrap one word per line.
// The share page runs the same table in e2e/publishing/share-table-long-urls.spec.ts.

const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;
const SLACK = 0.5;

const HEADER = ['Conference', 'City', 'Dates', 'Format', 'Apply', 'Fit', 'Status'];
const ROWS = [
  ['Open source and cloud native infrastructure conference', 'Pune', 'May', 'Talk', 'https://hasgeek.com/rootconf/call-for-submissions-distributed-systems-workshops/', 'High', 'Open'],
  ['Open source summit for infrastructure engineers', 'Bangkok', 'March', 'Workshop', 'https://eventyay.com/e/fossasia-summit-2026/cfs/call-for-proposals-open-source', 'Medium', 'Sent'],
];
// Prose cells of several words: with the URLs broken, they must not sit one word per line.
const PROSE = ROWS.map((row) => row[0]);
const URLS = ROWS.map((row) => row[4]);

const box = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cellHtml = (tag: 'th' | 'td', text: string) =>
  `<${tag}>${/^https?:/.test(text) ? `<a href="${escapeHtml(text)}">${escapeHtml(text)}</a>` : escapeHtml(text)}</${tag}>`;
const tableHtml = [HEADER, ...ROWS]
  .map((cells, r) => `<tr>${cells.map((cell) => cellHtml(r === 0 ? 'th' : 'td', cell)).join('')}</tr>`)
  .join('');

async function buildNote(page: Page): Promise<{ editor: Locator; table: Locator }> {
  await createNote(page, { title: `Long URLs ${Date.now()}`, body: 'Call for submissions tracker.' });
  const editor = activeEditor(page);
  await page.keyboard.press('Enter');
  await editor.evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, `<table><tbody>${tableHtml}</tbody></table>`);
  const table = editor.getByRole('table');
  await expect(table).toHaveCount(1);
  return { editor, table };
}

test('editor: a table with long URLs fits the note column and the URLs wrap in their cells', async ({ app }) => {
  await app.setViewportSize(VIEWPORTS.desktop);
  const { editor, table } = await buildNote(app);

  for (const viewport of ['desktop', 'mobile'] as const) {
    await app.setViewportSize(VIEWPORTS[viewport]);
    const text = await box(editor.getByText('Call for submissions tracker.'));
    const wrapper = await box(table.locator('xpath=..'));
    expect(wrapper.x + wrapper.width).toBeLessThanOrEqual(text.x + text.width + SLACK);

    if (viewport === 'desktop') {
      // Fits: the wrapper has nothing to scroll and the last column is inside the column.
      expect(await table.locator('xpath=..').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const last = await box(table.locator('th').last());
      expect(last.x + last.width).toBeLessThanOrEqual(text.x + text.width + SLACK);
      // The URLs wrap onto several lines.
      for (const url of URLS) {
        expect((await box(table.getByRole('link', { name: url }))).height).toBeGreaterThan(30);
      }
      // A multi-word cell has fewer lines than words.
      for (const prose of PROSE) {
        const lines = await lineCount(table.getByRole('cell', { name: prose, exact: true }), table.getByRole('columnheader', { name: 'City', exact: true }));
        expect(lines).toBeLessThan(prose.split(' ').length);
      }
    }
    await expect(table.locator('th')).toHaveCount(HEADER.length);
    expect(await app.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await table.locator('xpath=..').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const frame = await box(table.locator('xpath=..'));
    await screenshotInBothThemes(app, (theme) => `table-long-urls-editor-${theme}-${viewport}.png`, undefined, {
      clip: { x: Math.max(0, frame.x - 16), y: frame.y - 16, width: Math.min(frame.width + 32, VIEWPORTS[viewport].width), height: frame.height + 32 },
    });
  }
});
