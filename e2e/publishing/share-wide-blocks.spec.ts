import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #408: on the share page text keeps its reading column, and a block that needs
// room (code, table, image, live block) grows past it up to the wide measure.
// Code never wraps. Takes the screenshots the issue asks for: the fixture note
// at 1440px and 390px, light and dark.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;
// `min(100vw - 2rem, 72rem)` in src/index.css ("Share page").
const wideMeasure = (viewportWidth: number) => Math.min(viewportWidth - 32, 1152);
// A sub-pixel of rounding between two measured boxes.
const SLACK = 0.5;

const PARAGRAPHS = [
  'The reading column stays at a comfortable measure for prose, so a paragraph like this one wraps where the eye expects it to, however wide the window is.',
  'Blocks that need more room than that take it: the diagram, the wide table and the framed page below are each as wide as their own content, up to a wider measure.',
];

const SHORT_CODE = "const greeting = 'hello';\nconsole.log(greeting);";

// An ASCII diagram, 120 characters a line: wrapping any line destroys it.
const LONG_CODE = (() => {
  const rule = `+${'-'.repeat(58)}+${'-'.repeat(59)}+`;
  const row = (left: string, right: string) => `| ${left.padEnd(56)} | ${right.padEnd(57)} |`;
  return [
    rule,
    row('Editor (Yjs)', 'Homebase'),
    rule,
    row('PGliteProvider persists every update', 'SyncService pulls, merges and pushes'),
    row('DocumentBroadcast tells the other tabs', 'InboxProcessor applies remote changes'),
    rule,
  ].join('\n');
})();

const SMALL_TABLE = [
  ['Plan', 'Notes', 'Sync'],
  ['Free', 'Unlimited', 'Your Homebase'],
  ['Pro', 'Unlimited', 'Your Homebase'],
];

const COLUMNS = Array.from({ length: 10 }, (_, i) => i + 1);
const WIDE_TABLE = [
  COLUMNS.map((c) => `Measurement ${c}`),
  ...[1, 2, 3].map((r) => COLUMNS.map((c) => `Row ${r} reading for column ${c}`)),
];

const MERMAID = [
  'graph LR',
  '  Draft[Write a draft] --> Review{Ready to share?}',
  '  Review -->|Yes| Publish[Publish the note]',
  '  Review -->|Not yet| Draft',
  '  Publish --> Readers[Readers open the link]',
].join('\n');
const SVG_WIDTH = 900;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="120" viewBox="0 0 ${SVG_WIDTH} 120" fill="none" stroke="black" stroke-width="4"><rect x="10" y="10" width="${SVG_WIDTH - 20}" height="100" rx="12"/><path d="M40 80l60-40 60 40 60-40 60 40"/></svg>`;
const HTML = '<style>body{font-family:system-ui;margin:24px}</style><h2>Counter</h2><p>Clicked <b id="n">0</b> times.</p><button onclick="n.textContent=+n.textContent+1">Add one</button>';

// The share page reads a public note from its author's identity. There is no
// fake drive (#196): these are the GETs of one read, answered with canned
// values on a *.homebase.test identity, which the network fence would otherwise
// abort. Same approach as the share fixture in e2e/editor/live-blocks-design.spec.ts
// (#393). The profile lookups stay aborted, so the byline falls back to the identity.
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '7c1d4b8e-2f63-4a90-8e57-5b9a0c3d6f21';
const FILE_ID = '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34';
const NOTE_TITLE = 'Wide blocks on the share page';
const PUBLISHED = Date.UTC(2026, 8, 30, 9, 0);

const image = (width: number, height: number, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#8fa3ad"/><text x="24" y="48" font-family="sans-serif" font-size="24" fill="#1f2a30">${label}</text></svg>`;
// Image payloads by key: one narrower than the reading column, one wider than the wide measure.
const IMAGES: Record<string, { width: number; body: string }> = {
  jrnl_img_small: { width: 240, body: image(240, 120, '240 × 120') },
  jrnl_img_wide: { width: 1600, body: image(1600, 400, '1600 × 400') },
};

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.insert(0, children);
  return el;
}

const paragraph = (text: string) => element('paragraph', [new Y.XmlText(text)]);
const codeBlock = (language: string, code: string) => element('codeBlock', [new Y.XmlText(code)], { language });
const imageParagraph = (key: string) =>
  element('paragraph', [element('image', [], { src: `attachment://${FILE_ID}/${key}`, alt: key })]);
const table = (rows: string[][]) =>
  element(
    'table',
    rows.map((cells, r) => element('tableRow', cells.map((cell) => element(r === 0 ? 'tableHeader' : 'tableCell', [paragraph(cell)])))),
  );

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([
    paragraph(PARAGRAPHS[0]),
    paragraph(PARAGRAPHS[1]),
    codeBlock('ts', SHORT_CODE),
    codeBlock('', LONG_CODE),
    table(SMALL_TABLE),
    table(WIDE_TABLE),
    codeBlock('mermaid', MERMAID),
    codeBlock('svg', SVG),
    codeBlock('html', HTML),
    imageParagraph('jrnl_img_small'),
    imageParagraph('jrnl_img_wide'),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function mockPublicNote(page: Page): Promise<void> {
  const header = {
    fileId: FILE_ID,
    fileSystemType: 'Standard',
    fileMetadata: {
      isEncrypted: false,
      updated: PUBLISHED,
      payloads: [{ key: 'jrnl_txt' }],
      appData: { uniqueId: NOTE_ID, userDate: PUBLISHED, archivalStatus: 0, content: JSON.stringify({ title: NOTE_TITLE }) },
    },
  };
  // A page route takes precedence over the fence's context route.
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const url = new URL(route.request().url());
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      // The SDK reads a payload's type from this header.
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!url.pathname.endsWith('/payload')) {
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    }
    const picture = IMAGES[url.searchParams.get('key') ?? ''];
    return picture
      ? route.fulfill({ contentType: 'image/svg+xml', headers: { ...headers, decryptedcontenttype: 'image/svg+xml' }, body: picture.body })
      : route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() });
  });
}

/** Opens the fixture note and waits until every block has drawn. */
async function openNote(page: Page): Promise<Locator> {
  await mockPublicNote(page);
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  await expect(article.locator('[data-live-block="mermaid"] svg[id^="mermaid-"]')).toBeVisible({ timeout: 30_000 });
  await expect(article.locator('[data-live-block="svg"] img')).toBeVisible();
  // The frame is lazy: it loads once it is near the viewport.
  const frame = article.locator('[data-live-block="html"] iframe');
  await frame.scrollIntoViewIfNeeded();
  await expect(frame.contentFrame().getByRole('heading', { name: 'Counter' })).toBeVisible();
  for (const key of Object.keys(IMAGES)) {
    const picture = article.getByRole('img', { name: key });
    await picture.scrollIntoViewIfNeeded();
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(IMAGES[key].width);
  }
  return article;
}

/** The blocks of the fixture note, each as the box that is laid out in the article. */
function blocks(article: Locator) {
  const wrapperOf = (inner: Locator) => inner.locator('xpath=..');
  return {
    paragraph: article.getByText(PARAGRAPHS[0]),
    shortCode: article.locator('pre').filter({ hasText: 'greeting' }),
    longCode: article.locator('pre').filter({ hasText: 'PGliteProvider' }),
    smallTable: wrapperOf(article.getByRole('table').nth(0)),
    wideTable: wrapperOf(article.getByRole('table').nth(1)),
    mermaid: article.locator('[data-live-block="mermaid"]'),
    svg: article.locator('[data-live-block="svg"]'),
    html: article.locator('[data-live-block="html"]'),
    smallImage: article.getByRole('img', { name: 'jrnl_img_small' }),
    wideImage: article.getByRole('img', { name: 'jrnl_img_wide' }),
  };
}

const box = async (locator: Locator) => (await locator.boundingBox())!;
const centre = async (locator: Locator) => {
  const { x, width } = await box(locator);
  return x + width / 2;
};

/**
 * What a code block looks like on screen: its white-space, its visual line count,
 * whether every line starts at the same x, and whether it scrolls sideways.
 */
const codeLayout = (pre: Locator) =>
  pre.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.querySelector('code')!);
    // Where each visual line starts, by its top: a wrapped line adds a row of client rects at a new top.
    const starts = new Map<number, number>();
    for (const rect of range.getClientRects()) {
      const top = Math.round(rect.top);
      starts.set(top, Math.min(starts.get(top) ?? Infinity, Math.round(rect.left)));
    }
    return {
      whiteSpace: getComputedStyle(el).whiteSpace,
      lines: starts.size,
      aligned: new Set(starts.values()).size === 1,
      scrolls: el.scrollWidth > el.clientWidth,
    };
  });

const expectNoSidewaysPageScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

/**
 * Screenshots the whole note. The html block's sandboxed frame only paints inside
 * the viewport, so the viewport is made as tall as the page instead of using `fullPage`.
 */
async function shoot(page: Page, name: string): Promise<void> {
  const viewport = page.viewportSize()!;
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: viewport.width, height });
  // The frame paints again a moment after the resize: a screenshot taken before that shows it blank.
  const frame = page.locator('[data-live-block="html"] iframe').contentFrame();
  await expect(frame.getByRole('heading', { name: 'Counter' })).toBeVisible();
  await frame.locator('body').evaluate(() => new Promise<void>((painted) => requestAnimationFrame(() => requestAnimationFrame(() => painted()))));
  await page.screenshot({ path: test.info().outputPath(name) });
  await page.setViewportSize(viewport);
}

for (const theme of THEMES) {
  test(`share page: wide blocks grow past the reading column, ${theme} theme`, async ({ anonPage }) => {
    // The theme preference defaults to "system", which follows prefers-color-scheme.
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize(VIEWPORTS.desktop);
    const article = await openNote(anonPage);
    await expect(anonPage.locator('html')).toHaveClass(new RegExp(theme));
    const b = blocks(article);
    const sourceLines = LONG_CODE.split('\n').length;

    // Desktop, 1440px.
    const wide = wideMeasure(VIEWPORTS.desktop.width);
    const column = await box(b.paragraph);
    expect(column.width).toBeLessThan(wide);

    // Code never wraps; a block with long lines is wider than a paragraph.
    const longCode = await codeLayout(b.longCode);
    expect(longCode.whiteSpace).toBe('pre');
    expect(longCode.lines).toBe(sourceLines);
    expect(longCode.aligned).toBe(true);
    expect((await box(b.longCode)).width).toBeGreaterThan(column.width);

    // What fits the column stays that width.
    expect((await codeLayout(b.shortCode)).whiteSpace).toBe('pre');
    expect((await box(b.shortCode)).width).toBeLessThanOrEqual(column.width + SLACK);
    expect((await box(b.smallTable)).width).toBeLessThanOrEqual(column.width + SLACK);

    // What does not fit grows; an html block always has the wide measure.
    expect((await box(b.wideTable)).width).toBeGreaterThan(column.width);
    expect((await box(b.html)).width).toBeCloseTo(wide, 0);

    // Mermaid and svg blocks are as wide as their drawing (plus the frame's 16px padding and 1px border).
    const chrome = 2 * (16 + 1);
    const diagramWidth = await b.mermaid.locator('svg[id^="mermaid-"]').evaluate((svg: SVGSVGElement) => svg.viewBox.baseVal.width);
    expect((await box(b.mermaid)).width).toBeCloseTo(Math.max(column.width, Math.min(diagramWidth + chrome, wide)), 0);
    expect((await box(b.svg.locator('img'))).width).toBeCloseTo(SVG_WIDTH, 0);
    expect((await box(b.svg)).width).toBeCloseTo(SVG_WIDTH + chrome, 0);

    // An image that fits the column is where it always was; a bigger one grows to the wide measure.
    const smallImage = await box(b.smallImage);
    expect(smallImage.width).toBeCloseTo(IMAGES.jrnl_img_small.width, 0);
    expect(smallImage.x).toBeCloseTo(column.x, 0);
    expect((await box(b.wideImage)).width).toBeCloseTo(wide, 0);

    // Every wide block is centred on the column, which is centred on the page, and is inside the page.
    for (const block of [b.longCode, b.shortCode, b.smallTable, b.wideTable, b.mermaid, b.svg, b.html, b.wideImage]) {
      expect(await centre(block)).toBeCloseTo(column.x + column.width / 2, 0);
      const { x, width } = await box(block);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(VIEWPORTS.desktop.width);
      expect(width).toBeLessThanOrEqual(wide + SLACK);
    }
    await expectNoSidewaysPageScroll(anonPage);
    await shoot(anonPage, `share-wide-blocks-${theme}-1440.png`);

    // Phone, 390px: one column; wide content scrolls inside its own block.
    await anonPage.setViewportSize(VIEWPORTS.mobile);
    const phoneColumn = await box(b.paragraph);
    for (const block of [b.longCode, b.shortCode, b.smallTable, b.wideTable, b.mermaid, b.svg, b.html, b.smallImage, b.wideImage]) {
      const { x, width } = await box(block);
      expect(x).toBeGreaterThanOrEqual(phoneColumn.x - SLACK);
      expect(x + width).toBeLessThanOrEqual(phoneColumn.x + phoneColumn.width + SLACK);
    }
    expect(await codeLayout(b.longCode)).toEqual({ whiteSpace: 'pre', lines: sourceLines, aligned: true, scrolls: true });
    await expectNoSidewaysPageScroll(anonPage);
    await shoot(anonPage, `share-wide-blocks-${theme}-390.png`);
  });
}

test('share page: Copy puts a code block’s exact text on the clipboard', async ({ anonPage }) => {
  await anonPage.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await anonPage.setViewportSize(VIEWPORTS.desktop);
  const article = await openNote(anonPage);
  const clipboard = () => anonPage.evaluate(() => navigator.clipboard.readText());

  // One per code block; a live block has none, in its preview or its source.
  const copyButtons = article.getByRole('button', { name: 'Copy', exact: true });
  await expect(copyButtons).toHaveCount(2);
  await article.locator('[data-live-block="svg"]').getByRole('button', { name: 'View source' }).click();
  await expect(article.locator('[data-live-block="svg"] pre')).toBeVisible();
  await expect(copyButtons).toHaveCount(2);

  // With the mouse: the label says Copied, then goes back to Copy.
  const copyLong = blocks(article).longCode.locator('xpath=..').getByRole('button');
  await copyLong.click();
  await expect(copyLong).toHaveText('Copied');
  expect(await clipboard()).toBe(LONG_CODE);
  await expect(copyLong).toHaveText('Copy', { timeout: 5_000 });

  // With the keyboard: the button takes focus and Enter copies.
  const copyShort = blocks(article).shortCode.locator('xpath=..').getByRole('button');
  await copyShort.focus();
  await expect(copyShort).toBeFocused();
  await anonPage.keyboard.press('Enter');
  await expect(copyShort).toHaveText('Copied');
  expect(await clipboard()).toBe(SHORT_CODE);
});
