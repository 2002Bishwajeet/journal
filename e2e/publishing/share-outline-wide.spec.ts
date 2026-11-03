import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// A `wide` live block (#557) leaves the article column, and the "On this page" panel (#643)
// sits right of it from xl: the block must stop before the panel, and take its full width
// again when the reader hides the outline. Tables keep the column. Canned guest reads.

const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '5a1d7c20-5b3e-4f86-9a12-c0e8d3b7f561';
const FILE_ID = '5b2e8d31-6c4f-4097-8b23-d1f9e4c8a671';
const TITLE = 'Wide blocks beside the outline';
const PUBLISHED = Date.UTC(2026, 9, 12, 9, 0);

const HTML = `<style>body{font-family:system-ui;margin:16px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{border:1px solid #888;border-radius:8px;padding:12px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #888;padding:4px}</style>
<div class="cards"><div class="card">Revenue<br><b>$12.4k</b></div><div class="card">Users<br><b>1,204</b></div><div class="card">Churn<br><b>2.1%</b></div><div class="card">NPS<br><b>48</b></div></div>
<table><tr><th>Quarter</th><th>Revenue</th><th>Users</th><th>Churn</th><th>NPS</th><th>Notes</th></tr><tr><td>Q1</td><td>$10k</td><td>900</td><td>2.5%</td><td>41</td><td>Launch</td></tr></table>`;

const COLUMNS = Array.from({ length: 10 }, (_, i) => i + 1);
const WIDE_TABLE = [COLUMNS.map((c) => `Measurement ${c}`), ...[1, 2].map((r) => COLUMNS.map((c) => `Row ${r} reading for column ${c}`))];

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.insert(0, children);
  return el;
}
const p = (text: string) => element('paragraph', [new Y.XmlText(text)]);
const fill = (n: number) => Array.from({ length: n }, (_, i) => p(`Paragraph ${i}. A shared note is read by people who may never have heard of Journal, so the page around it should be quiet and finished.`));
const heading = (level: number, text: string) => element('heading', [new Y.XmlText(text)], { level: String(level) });

function content(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([
    heading(2, 'Intro'),
    ...fill(8),
    heading(2, 'Dashboard'),
    element('codeBlock', [new Y.XmlText(HTML)], { language: 'html wide' }),
    element('table', WIDE_TABLE.map((cells, r) => element('tableRow', cells.map((cell) => element(r === 0 ? 'tableHeader' : 'tableCell', [p(cell)]))))),
    ...fill(8),
    heading(3, 'Details'),
    ...fill(8),
    heading(2, 'Results'),
    ...fill(12),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

test.beforeEach(async ({ anonPage: page }) => {
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const url = route.request().url();
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!url.includes(NOTE_ID) && !url.includes(FILE_ID)) return route.fulfill({ status: 403, headers, contentType: 'application/json', body: '{}' });
    if (new URL(url).pathname.endsWith('/payload')) return route.fulfill({ contentType: 'application/octet-stream', headers, body: content() });
    return route.fulfill({
      contentType: 'application/json',
      headers,
      body: JSON.stringify({
        fileId: FILE_ID,
        fileSystemType: 'Standard',
        fileMetadata: {
          isEncrypted: false,
          updated: PUBLISHED,
          payloads: [{ key: 'jrnl_txt' }],
          appData: { uniqueId: NOTE_ID, userDate: PUBLISHED, archivalStatus: 0, content: JSON.stringify({ title: TITLE }) },
        },
      }),
    });
  });
});

type Box = { x: number; y: number; width: number; height: number };
const box = async (l: Locator): Promise<Box> => (await l.boundingBox())!;
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const panel = (page: Page) => page.getByRole('complementary', { name: 'On this page' });
// The sticky part of the panel (the aside itself is as tall as the article).
const panelBody = (page: Page) => panel(page).locator('> div');
const wideBlock = (page: Page) => page.locator('[data-live-block-wide]');
const tableWrapper = (page: Page) => page.getByRole('article').getByRole('table').locator('xpath=..');

/** Scrolls the block to the panel's height, so the sticky panel is beside it. */
async function besidePanel(page: Page, block: Locator): Promise<void> {
  await block.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 100));
  // Let the scroll-driven sticky panel settle before the screenshot.
  await page.waitForTimeout(200);
}

async function shots(page: Page, name: (theme: string) => string): Promise<void> {
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
    await page.evaluate((t) => document.documentElement.classList.remove('light', 'dark', t), theme);
    await page.evaluate((t) => document.documentElement.classList.add(t), theme);
    // Let the theme transition finish before the screenshot.
    await page.waitForTimeout(400);
    await page.screenshot({ path: test.info().outputPath(name(theme)) });
  }
}

for (const width of [1280, 1440, 1920]) {
  test(`wide block and table never run under the outline panel, ${width}px`, async ({ anonPage: page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
    await assertTestOrigin(page);
    const article = page.getByRole('article');
    await expect(article.getByRole('heading', { level: 1, name: TITLE })).toBeVisible({ timeout: 15_000 });
    await expect(panel(page).getByRole('link')).toHaveCount(4);
    const frame = wideBlock(page).locator('iframe');
    await frame.scrollIntoViewIfNeeded();
    await expect(frame.contentFrame().getByText('Revenue').first()).toBeVisible();

    const column = await box(article);
    for (const block of [wideBlock(page), tableWrapper(page)]) {
      await besidePanel(page, block);
      const [b, side] = [await box(block), await box(panelBody(page))];
      console.log(`${width}px block x ${b.x.toFixed(0)}..${(b.x + b.width).toFixed(0)}, panel x ${side.x.toFixed(0)}..${(side.x + side.width).toFixed(0)}`);
      expect(intersects(b, side), `block ${JSON.stringify(b)} vs panel ${JSON.stringify(side)}`).toBe(false);
      expect(b.x + b.width).toBeLessThanOrEqual(side.x - 16);
    }
    // Still wider than the column where there is room on the left.
    const shown = await box(wideBlock(page));
    expect(shown.width).toBeGreaterThan(column.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width === 1440) {
      await besidePanel(page, wideBlock(page));
      await shots(page, (theme) => `share-outline-wide-${theme}-1440.png`);
    }

    // Hidden outline: the block takes its full, centred width again.
    await panel(page).getByRole('button', { name: 'Hide contents' }).click();
    await expect(panel(page).getByRole('link')).toHaveCount(0);
    const hidden = await box(wideBlock(page));
    expect(hidden.width).toBeGreaterThanOrEqual(shown.width);
    expect(Math.abs(hidden.x + hidden.width / 2 - (column.x + column.width / 2))).toBeLessThanOrEqual(2);
  });
}
