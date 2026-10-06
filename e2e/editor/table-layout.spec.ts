import type { Locator, Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// #447: a table with no saved column widths sizes its columns to content, its
// cells are compact, and a wide table scrolls inside itself. The share page
// asserts the same numbers (e2e/publishing/share-wide-blocks.spec.ts), so the
// two places look alike. Takes the screenshots the issue asks for: a two-column
// key/value table and a three-column table, light and dark, at 1280px and 390px.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;
// A sub-pixel of rounding between two measured boxes.
const SLACK = 0.5;

// What a cell's padding and a one-line row's height are, in both places: 0.5rem 0.75rem
// of padding, a 14px font on a 24px line, and the 1px collapsed border.
const CELL_PADDING = '8px 12px';
const ROW_HEIGHT = 41;

const INTRO = 'Tables take only the room their text needs.';
const KEY_VALUE = [
  ['Key', 'Value'],
  ['Supervisor', 'Dr. Rao reviews each chapter draft before it goes to the second reader, usually within two weeks'],
  ['Deadline', 'Submit to the graduate office by the last working day of March'],
];
// A word that cannot wrap is wider than a phone column on its own, so the three
// columns together are wider than any column and the wrapper has to scroll.
const THREE_COLUMNS = [
  ['Chapter', 'Method', 'Evidence'],
  ['Introduction', 'Literature review', 'peer_reviewed_articles_2019_to_2025.pdf'],
  ['Analysis', 'Interviews', 'anonymised_transcripts_twelve_participants.pdf'],
];

const box = async (locator: Locator) => (await locator.boundingBox())!;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tableHtml = (rows: string[][]) =>
  `<table><tbody>${rows
    .map((cells, r) => `<tr>${cells.map((cell) => `<${r === 0 ? 'th' : 'td'}>${escapeHtml(cell)}</${r === 0 ? 'th' : 'td'}>`).join('')}</tr>`)
    .join('')}</tbody></table>`;

/**
 * A note with a line of text and the two tables, pasted through the editor's real
 * paste path (ProseMirror parses text/html). A pasted table has no saved column widths.
 */
async function buildNote(page: Page, title: string): Promise<{ editor: Locator; keyValue: Locator; threeColumns: Locator }> {
  await createNote(page, { title, body: INTRO });
  const editor = activeEditor(page);
  await page.keyboard.press('Enter');
  await editor.evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, tableHtml(THREE_COLUMNS) + tableHtml(KEY_VALUE));
  const tables = editor.getByRole('table');
  await expect(tables).toHaveCount(2);
  return { editor, keyValue: tables.nth(1), threeColumns: tables.first() };
}

/** The wrapper TipTap puts around a table. */
const wrapperOf = (table: Locator) => table.locator('xpath=..');

for (const theme of THEMES) {
  test(`editor: tables size to content, are compact and scroll inside themselves, ${theme} theme`, async ({ app }) => {
    // The theme preference defaults to "system", which follows prefers-color-scheme.
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize(VIEWPORTS.desktop);
    const { editor, keyValue, threeColumns } = await buildNote(app, `Tables ${theme} ${Date.now()}`);
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));

    for (const viewport of ['desktop', 'mobile'] as const) {
      await app.setViewportSize(VIEWPORTS[viewport]);
      // The text column: the editor's content box.
      const text = await box(editor.getByText(INTRO));
      const column = { left: text.x, right: text.x + text.width };

      for (const table of [keyValue, threeColumns]) {
        // Lines up with the text and is never wider than the text column.
        const wrapper = await box(wrapperOf(table));
        expect(wrapper.x).toBeGreaterThanOrEqual(column.left - SLACK);
        expect(wrapper.x).toBeLessThanOrEqual(column.left + SLACK);
        expect(wrapper.x + wrapper.width).toBeLessThanOrEqual(column.right + SLACK);
        expect((await box(table)).x).toBeCloseTo(wrapper.x, 0);

        // Compact cells: the cell's padding alone, no paragraph margin.
        const cell = table.locator('td').first();
        expect(await cell.evaluate((el) => {
          const { paddingTop, paddingRight, paddingBottom, paddingLeft } = getComputedStyle(el);
          return paddingTop === paddingBottom && paddingLeft === paddingRight ? `${paddingTop} ${paddingLeft}` : 'uneven';
        })).toBe(CELL_PADDING);
        expect(await cell.locator('p').evaluate((p) => getComputedStyle(p).margin)).toBe('0px');
        // The header row holds one line of text in every column.
        expect((await box(table.locator('tr').first())).height).toBeCloseTo(ROW_HEIGHT, 0);
      }

      // A key column is narrower than its value column.
      const key = await box(keyValue.locator('th').first());
      const value = await box(keyValue.locator('th').last());
      expect(key.width).toBeLessThan(value.width);

      // The wide table scrolls inside its wrapper, not the page.
      const scrolls = await wrapperOf(threeColumns).evaluate((el) => el.scrollWidth > el.clientWidth);
      expect(scrolls).toBe(viewport === 'mobile');
      expect(await app.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      for (const [name, table] of [['key-value', keyValue], ['three-columns', threeColumns]] as const) {
        await wrapperOf(table).evaluate((el) => el.scrollIntoView({ block: 'center' }));
        const frame = await box(wrapperOf(table));
        await app.screenshot({
          path: test.info().outputPath(`table-${name}-editor-${theme}-${viewport}.png`),
          clip: { x: Math.max(0, frame.x - 16), y: frame.y - 16, width: Math.min(frame.width + 32, VIEWPORTS[viewport].width), height: frame.height + 32 },
        });
      }
    }
  });
}

test('editor: a resized column keeps its width after a reload', async ({ app }) => {
  await app.setViewportSize(VIEWPORTS.desktop);
  const { editor, keyValue } = await buildNote(app, `Resize ${Date.now()}`);
  const firstHeader = keyValue.locator('th').first();
  const before = await box(firstHeader);

  // The column resize handle is the right edge of the cell.
  await app.mouse.move(before.x + before.width - 2, before.y + before.height / 2);
  await app.mouse.down();
  await app.mouse.move(before.x + before.width + 118, before.y + before.height / 2, { steps: 8 });
  await app.mouse.up();
  const resized = (await box(firstHeader)).width;
  expect(resized).toBeCloseTo(before.width + 120, -1);

  // Typed after the drag, so its preview in the note list means the width has been written too.
  await editor.getByText(INTRO).click();
  await app.keyboard.press('Home');
  await app.keyboard.type('Resized ');
  await expect(app.getByRole('button').filter({ hasText: 'Resized' }).first()).toBeVisible();
  await app.reload();
  await waitForAppReady(app);

  const reloaded = activeEditor(app).getByRole('table').nth(1);
  await expect(reloaded.locator('th')).toHaveCount(2);
  expect((await box(reloaded.locator('th').first())).width).toBeCloseTo(resized, 0);
});
