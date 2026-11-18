import type { Locator, Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, screenshotInBothThemes } from '../support/actions';
import { lineCount } from '../support/tableLines';

// #1389: a table with no saved column widths caps each column, so one cell of long prose
// does not take the table over. A table wider than the note column fades the edge that has
// hidden content, and a resized table keeps the widths that were dragged. The share page
// runs the same table in e2e/publishing/share-table-scroll-shade.spec.ts.

const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;
const SLACK = 0.5;
// The cap on an auto-layout cell: 22rem at 16px.
const CAP = 22 * 16;

const HEADER = ['Conference', 'City', 'Dates', 'Format', 'Topics', 'Apply', 'Status'];
const ROWS = [
  [
    'Open source and cloud native infrastructure conference',
    'Pune',
    'May',
    'In person talks and workshops for maintainers and platform teams who run production clusters',
    'Distributed systems, observability, storage, security hardening, reproducible builds and supply chain safety for small teams',
    'https://hasgeek.com/rootconf/call-for-submissions-distributed-systems-workshops/',
    'Open',
  ],
  [
    'Open source summit for infrastructure engineers',
    'Bangkok',
    'March',
    'Hybrid talks with a recorded track and a live hallway track for everyone who cannot travel',
    'Local first software, sync engines, browser databases, accessibility and privacy by design for note taking apps',
    'https://eventyay.com/e/fossasia-summit-2026/cfs/call-for-proposals-open-source',
    'Sent',
  ],
];
const SHORT = [
  ['Key', 'Value'],
  ['Supervisor', 'Dr. Rao'],
];
const PROSE_CELLS = [ROWS[0][3], ROWS[0][4], ROWS[1][3], ROWS[1][4]];

const box = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cellHtml = (tag: 'th' | 'td', text: string) =>
  `<${tag}>${/^https?:/.test(text) ? `<a href="${escapeHtml(text)}">${escapeHtml(text)}</a>` : escapeHtml(text)}</${tag}>`;
const tableHtml = (rows: string[][]) =>
  `<table><tbody>${rows.map((cells, r) => `<tr>${cells.map((cell) => cellHtml(r === 0 ? 'th' : 'td', cell)).join('')}</tr>`).join('')}</tbody></table>`;

const wrapperOf = (table: Locator) => table.locator('xpath=..');
// Which edges the wrapper fades: [start, end].
const shade = (table: Locator) =>
  wrapperOf(table).evaluate((el) => [el.hasAttribute('data-shade-start'), el.hasAttribute('data-shade-end')]);

async function buildNote(page: Page): Promise<{ editor: Locator; cfp: Locator; short: Locator }> {
  await createNote(page, { title: `Scroll shade ${Date.now()}`, body: 'Call for submissions tracker.' });
  const editor = activeEditor(page);
  await page.keyboard.press('Enter');
  await editor.evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, tableHtml([HEADER, ...ROWS]) + tableHtml(SHORT));
  const tables = editor.getByRole('table');
  await expect(tables).toHaveCount(2);
  return { editor, cfp: tables.nth(0), short: tables.nth(1) };
}

async function shoot(page: Page, table: Locator, name: string, viewport: keyof typeof VIEWPORTS) {
  await wrapperOf(table).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const frame = await box(wrapperOf(table));
  await screenshotInBothThemes(page, (theme) => `table-${name}-editor-${theme}-${viewport}.png`, undefined, {
    clip: { x: Math.max(0, frame.x - 16), y: frame.y - 16, width: Math.min(frame.width + 32, VIEWPORTS[viewport].width), height: frame.height + 32 },
  });
}

test('editor: no column is wider than the cap, and long prose is not a word per line', async ({ app }) => {
  await app.setViewportSize(VIEWPORTS.desktop);
  const { cfp } = await buildNote(app);
  for (const header of await cfp.locator('th').all()) {
    expect((await box(header)).width).toBeLessThanOrEqual(CAP + SLACK);
  }
  for (const prose of PROSE_CELLS) {
    const lines = await lineCount(cfp.getByRole('cell', { name: prose, exact: true }), cfp.getByRole('columnheader', { name: 'City', exact: true }));
    expect(lines).toBeLessThan(prose.split(' ').length / 2);
  }
  await shoot(app, cfp, 'cfp-start', 'desktop');
});

test('editor: a table that overflows fades the hidden edge, and one that fits fades none', async ({ app }) => {
  await app.setViewportSize(VIEWPORTS.mobile);
  const { cfp, short } = await buildNote(app);
  const wrapper = wrapperOf(cfp);

  expect(await wrapper.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect.poll(() => shade(cfp)).toEqual([false, true]);
  expect(await wrapper.evaluate((el) => getComputedStyle(el).maskImage)).toContain('linear-gradient');
  await shoot(app, cfp, 'cfp-start', 'mobile');

  await wrapper.evaluate((el) => el.scrollTo({ left: el.scrollWidth / 3 }));
  await expect.poll(() => shade(cfp)).toEqual([true, true]);
  await shoot(app, cfp, 'cfp-middle', 'mobile');

  await wrapper.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect.poll(() => shade(cfp)).toEqual([true, false]);
  await shoot(app, cfp, 'cfp-end', 'mobile');

  // A table that fits has nothing hidden and no shade.
  expect(await wrapperOf(short).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await shade(short)).toEqual([false, false]);
  expect(await wrapperOf(short).evaluate((el) => getComputedStyle(el).maskImage)).toBe('none');
  await shoot(app, short, 'short', 'mobile');

  // The shade takes no clicks: a tap at the faded right edge still lands in a cell.
  await wrapper.evaluate((el) => el.scrollTo({ left: 0 }));
  const frame = await box(wrapper);
  expect(await app.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('td, th') !== null, [frame.x + frame.width - 4, frame.y + 10])).toBe(true);
});

test('editor: a resized column keeps its dragged width, past the cap', async ({ app }) => {
  await app.setViewportSize(VIEWPORTS.desktop);
  const { short } = await buildNote(app);
  const firstHeader = short.locator('th').first();
  const before = await box(firstHeader);
  const drag = 400;

  // The column resize handle is the right edge of the cell.
  await app.mouse.move(before.x + before.width - 2, before.y + before.height / 2);
  await app.mouse.down();
  await app.mouse.move(before.x + before.width + drag - 2, before.y + before.height / 2, { steps: 8 });
  await app.mouse.up();

  const resized = (await box(firstHeader)).width;
  expect(resized).toBeCloseTo(before.width + drag, -1);
  expect(resized).toBeGreaterThan(CAP);
  await shoot(app, short, 'resized', 'desktop');

  // The width is saved: it survives a reload.
  await activeEditor(app).getByText('Call for submissions tracker.').click();
  await app.keyboard.type(' Resized');
  await expect(app.getByRole('button').filter({ hasText: 'Resized' }).first()).toBeVisible();
  await app.reload();
  await waitForAppReady(app);
  const reloaded = activeEditor(app).getByRole('table').nth(1);
  expect((await box(reloaded.locator('th').first())).width).toBeCloseTo(resized, 0);
});
