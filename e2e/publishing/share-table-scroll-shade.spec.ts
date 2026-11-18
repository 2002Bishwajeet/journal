import type { Locator } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { lineCount } from '../support/tableLines';

// #1389: on the share page a table caps each column and fades the edge that has hidden
// content, the same way the editor does (e2e/editor/table-scroll-shade.spec.ts).
// Screenshots: desktop and phone, light and dark.

const THEMES = ['light', 'dark'] as const;
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

// The share page reads a public note from its author's identity: canned GETs on a
// *.homebase.test identity (same approach as share-wide-blocks.spec.ts).
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '7c1d4b8e-2f63-4a90-8e57-5b9a0c3d6f22';
const FILE_ID = '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a35';
const NOTE_TITLE = 'Call for submissions tracker';
const INTRO = 'Every call for submissions I am watching this year.';
const PUBLISHED = Date.UTC(2026, 8, 30, 9, 0);

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.insert(0, children);
  return el;
}

const paragraph = (children: (Y.XmlElement | Y.XmlText)[]) => element('paragraph', children);
// A bare URL is a text run with a link mark.
const linkText = (url: string) => {
  const text = new Y.XmlText();
  text.insert(0, url, { link: { href: url } });
  return text;
};
const cell = (tag: 'tableHeader' | 'tableCell', value: string) =>
  element(tag, [paragraph([/^https?:/.test(value) ? linkText(value) : new Y.XmlText(value)])]);

const table = (rows: string[][]) =>
  element(
    'table',
    rows.map((cells, r) => element('tableRow', cells.map((value) => cell(r === 0 ? 'tableHeader' : 'tableCell', value)))),
  );

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([paragraph([new Y.XmlText(INTRO)]), table([HEADER, ...ROWS]), table(SHORT)]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

const box = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
};

// Which edges the wrapper fades: [start, end].
const shade = (wrapper: Locator) => wrapper.evaluate((el) => [el.hasAttribute('data-shade-start'), el.hasAttribute('data-shade-end')]);

for (const theme of THEMES) {
  test(`share page: columns are capped and an overflowing table fades its hidden edge, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize(VIEWPORTS.desktop);
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
    await anonPage.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
      const headers = {
        'access-control-allow-origin': new URL(anonPage.url()).origin,
        'access-control-allow-credentials': 'true',
        'access-control-expose-headers': 'decryptedcontenttype',
      };
      return new URL(route.request().url()).pathname.endsWith('/payload')
        ? route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() })
        : route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    });
    await anonPage.goto(`/share/${AUTHOR}/${NOTE_ID}`);
    await assertTestOrigin(anonPage);
    const article = anonPage.getByRole('article');
    await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
    const tables = article.getByRole('table');
    await expect(tables).toHaveCount(2);
    const cfp = tables.nth(0);
    const wrapper = cfp.locator('xpath=..');
    const shortWrapper = tables.nth(1).locator('xpath=..');
    await expect(cfp.locator('th')).toHaveCount(HEADER.length);

    const shoot = async (target: Locator, name: string, viewport: keyof typeof VIEWPORTS) => {
      await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const frame = await box(target);
      await anonPage.screenshot({
        path: test.info().outputPath(`table-${name}-share-${theme}-${viewport}.png`),
        clip: { x: Math.max(0, frame.x - 16), y: frame.y - 16, width: Math.min(frame.width + 32, VIEWPORTS[viewport].width), height: frame.height + 32 },
      });
    };

    // Desktop: no column is wider than the cap, and long prose is not a word per line.
    for (const th of await cfp.locator('th').all()) expect((await box(th)).width).toBeLessThanOrEqual(CAP + SLACK);
    for (const prose of PROSE_CELLS) {
      const lines = await lineCount(cfp.getByRole('cell', { name: prose, exact: true }), cfp.getByRole('columnheader', { name: 'City', exact: true }));
      expect(lines).toBeLessThan(prose.split(' ').length / 2);
    }
    await shoot(wrapper, 'cfp-start', 'desktop');

    // Phone: the right edge is shaded at the start, both in the middle, the left at the end.
    await anonPage.setViewportSize(VIEWPORTS.mobile);
    expect(await wrapper.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect.poll(() => shade(wrapper)).toEqual([false, true]);
    expect(await wrapper.evaluate((el) => getComputedStyle(el).maskImage)).toContain('linear-gradient');
    await shoot(wrapper, 'cfp-start', 'mobile');

    await wrapper.evaluate((el) => el.scrollTo({ left: el.scrollWidth / 3 }));
    await expect.poll(() => shade(wrapper)).toEqual([true, true]);
    await shoot(wrapper, 'cfp-middle', 'mobile');

    await wrapper.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect.poll(() => shade(wrapper)).toEqual([true, false]);
    await shoot(wrapper, 'cfp-end', 'mobile');

    // A table that fits has no shade.
    expect(await shortWrapper.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await shade(shortWrapper)).toEqual([false, false]);
    expect(await shortWrapper.evaluate((el) => getComputedStyle(el).maskImage)).toBe('none');
    await shoot(shortWrapper, 'short', 'mobile');
  });
}
