import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, screenshotInBothThemes } from '../support/actions';

// #1390: a table wider than the note column keeps its first column in view while the rest
// scrolls. The share page runs the same table in e2e/publishing/share-table-pinned-column.spec.ts.

const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;

// The first column is short on purpose: a pinned column takes at most 40% of a phone-width wrapper,
// and auto layout sizes a prose first column up to the 22rem cap, which is wider than that.
const HEADER = ['Conference', 'City', 'Dates', 'Format', 'Topics', 'Apply', 'Status'];
const ROWS = [
  [
    'Rootconf',
    'Pune',
    'May',
    'In person talks and workshops for maintainers and platform teams who run production clusters',
    'Distributed systems, observability, storage, security hardening, reproducible builds and supply chain safety for small teams',
    'https://hasgeek.com/rootconf/call-for-submissions-distributed-systems-workshops/',
    'Open',
  ],
  [
    'FOSSASIA',
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

const box = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cellHtml = (tag: 'th' | 'td', text: string) =>
  `<${tag}>${/^https?:/.test(text) ? `<a href="${escapeHtml(text)}">${escapeHtml(text)}</a>` : escapeHtml(text)}</${tag}>`;
// `header: false` is a headerless table: every row is td (#446).
const tableHtml = (rows: string[][], header = true) =>
  `<table><tbody>${rows.map((cells, r) => `<tr>${cells.map((cell) => cellHtml(header && r === 0 ? 'th' : 'td', cell)).join('')}</tr>`).join('')}</tbody></table>`;

const wrapperOf = (table: Locator) => table.locator('xpath=..');
const pinned = (table: Locator) => wrapperOf(table).evaluate((el) => el.hasAttribute('data-pin'));

async function buildNote(page: Page): Promise<{ cfp: Locator; short: Locator; headerless: Locator }> {
  await createNote(page, { title: `Pinned column ${Date.now()}`, body: 'Call for submissions tracker.' });
  const editor = activeEditor(page);
  await page.keyboard.press('Enter');
  await editor.evaluate(
    (el, html) => {
      const data = new DataTransfer();
      data.setData('text/html', html);
      data.setData('text/plain', '');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    },
    tableHtml([HEADER, ...ROWS]) + tableHtml(SHORT) + tableHtml([HEADER, ...ROWS], false),
  );
  const tables = editor.getByRole('table');
  await expect(tables).toHaveCount(3);
  return { cfp: tables.nth(0), short: tables.nth(1), headerless: tables.nth(2) };
}

async function shoot(page: Page, table: Locator, name: string, viewport: keyof typeof VIEWPORTS) {
  await wrapperOf(table).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const frame = await box(wrapperOf(table));
  await screenshotInBothThemes(page, (theme) => `table-${name}-editor-${theme}-${viewport}.png`, undefined, {
    clip: { x: Math.max(0, frame.x - 16), y: frame.y - 16, width: Math.min(frame.width + 32, VIEWPORTS[viewport].width), height: frame.height + 32 },
  });
}

/** The first column's cell and the one beside it, in the first row. */
const firstRow = (table: Locator) => ({
  first: table.locator('tr').first().locator('th, td').first(),
  second: table.locator('tr').first().locator('th, td').nth(1),
});

test('editor: the first column stays in view while a wide table scrolls, and a table that fits is unchanged', async ({ app }) => {
  // Build the note at desktop width: the note list is hidden on a phone, and createNote waits for its row.
  await app.setViewportSize(VIEWPORTS.desktop);
  const { cfp, short, headerless } = await buildNote(app);
  await app.setViewportSize(VIEWPORTS.mobile);
  const wrapper = wrapperOf(cfp);
  const { first, second } = firstRow(cfp);

  expect(await wrapper.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect.poll(() => pinned(cfp)).toBe(true);
  await shoot(app, cfp, 'pinned-start', 'mobile');

  // Scrolled across the table: column 1 is still at the wrapper's left edge, on top, and opaque.
  await wrapper.evaluate((el) => el.scrollTo({ left: el.scrollWidth / 2 }));
  await expect.poll(() => wrapper.evaluate((el) => el.hasAttribute('data-shade-start'))).toBe(true);
  const frame = await box(wrapper);
  const firstBox = await box(first);
  expect(Math.abs(firstBox.x - frame.x)).toBeLessThanOrEqual(1);
  expect(firstBox.width).toBeLessThanOrEqual(frame.width * 0.4 + 2);
  expect((await box(second)).x).toBeLessThan(frame.x); // column 2 has scrolled away under it
  expect(
    await first.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('th, td') === el;
    }),
  ).toBe(true);
  expect(await first.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
  const bodyCell = cfp.locator('tr').nth(1).locator('td').first();
  expect(await bodyCell.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  await shoot(app, cfp, 'pinned-middle', 'mobile');

  await wrapper.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect.poll(() => wrapper.evaluate((el) => el.hasAttribute('data-shade-end'))).toBe(false);
  expect(Math.abs((await box(first)).x - frame.x)).toBeLessThanOrEqual(1);
  await shoot(app, cfp, 'pinned-end', 'mobile');

  // A headerless table (every cell a td) pins its first column too.
  await expect.poll(() => pinned(headerless)).toBe(true);
  await wrapperOf(headerless).evaluate((el) => el.scrollTo({ left: el.scrollWidth / 2 }));
  const headerlessFrame = await box(wrapperOf(headerless));
  expect(Math.abs((await box(firstRow(headerless).first)).x - headerlessFrame.x)).toBeLessThanOrEqual(1);
  await shoot(app, headerless, 'pinned-headerless-middle', 'mobile');

  // A table that fits is not touched: no pin, no sticky cell, collapsed borders as before.
  expect(await wrapperOf(short).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await pinned(short)).toBe(false);
  expect(await firstRow(short).first.evaluate((el) => getComputedStyle(el).position)).toBe('relative');
  expect(await short.evaluate((el) => getComputedStyle(el).borderCollapse)).toBe('collapse');
  await shoot(app, short, 'pinned-short', 'mobile');

  // Desktop: the table that fits is still unchanged.
  await app.setViewportSize(VIEWPORTS.desktop);
  expect(await pinned(short)).toBe(false);
  await shoot(app, short, 'pinned-short', 'desktop');
  await shoot(app, cfp, 'pinned-cfp', 'desktop');
});

test('editor: typing, the row menu and the column menu work on a pinned first column', async ({ app }) => {
  await app.setViewportSize(VIEWPORTS.desktop);
  const { cfp } = await buildNote(app);
  await app.setViewportSize(VIEWPORTS.mobile);
  await expect.poll(() => pinned(cfp)).toBe(true);
  const wrapper = wrapperOf(cfp);
  await wrapper.evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    el.scrollTo({ left: el.scrollWidth / 2 });
  });
  const cell = cfp.locator('tr').nth(1).locator('td').first();

  // Typing in a pinned cell: the click lands in it, not in a cell that scrolled under it.
  await cell.click();
  await app.keyboard.type('PINNED');
  await expect(cell).toContainText('PINNED');

  // Row options on the pinned row.
  await cell.hover();
  await app.getByRole('button', { name: 'Row options' }).click();
  await expect(app.getByRole('button', { name: 'Header row' })).toBeVisible();
  await app.keyboard.press('Escape');

  // Column options on the pinned column: insert a column to its right.
  await firstRow(cfp).first.hover();
  await app.getByRole('button', { name: 'Column options' }).click();
  await app.getByRole('button', { name: 'Insert column right' }).click();
  await expect(cfp.locator('tr').first().locator('th')).toHaveCount(HEADER.length + 1);
  await expect.poll(() => pinned(cfp)).toBe(true);
  expect(Math.abs((await box(firstRow(cfp).first)).x - (await box(wrapper)).x)).toBeLessThanOrEqual(1);
});

test('editor: the column resize handle shows at the border of the pinned column', async ({ app }) => {
  await app.setViewportSize(VIEWPORTS.desktop);
  const { cfp } = await buildNote(app);
  await app.setViewportSize(VIEWPORTS.mobile);
  await expect.poll(() => pinned(cfp)).toBe(true);
  await wrapperOf(cfp).evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    el.scrollTo({ left: el.scrollWidth / 2 });
  });
  const first = await box(firstRow(cfp).first);
  await app.mouse.move(first.x + first.width - 2, first.y + first.height / 2);
  await expect(activeEditor(app).locator('.column-resize-handle').first()).toHaveCSS('opacity', '1');
});
