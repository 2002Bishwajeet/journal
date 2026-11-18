import type { Locator } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #1390: on the share page a table wider than the note column keeps its first column in
// view while the rest scrolls, the same way the editor does
// (e2e/editor/table-pinned-column.spec.ts). Screenshots: desktop and phone, light and dark.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;

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

// The share page reads a public note from its author's identity: canned GETs on a
// *.homebase.test identity (same approach as share-table-scroll-shade.spec.ts).
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

const pinned = (wrapper: Locator) => wrapper.evaluate((el) => el.hasAttribute('data-pin'));

for (const theme of THEMES) {
  test(`share page: the first column stays in view while a wide table scrolls, ${theme} theme`, async ({ anonPage }) => {
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
    const first = cfp.locator('tr').first().locator('th').first();
    const second = cfp.locator('tr').first().locator('th').nth(1);

    const shoot = async (target: Locator, name: string, viewport: keyof typeof VIEWPORTS) => {
      await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const frame = await box(target);
      await anonPage.screenshot({
        path: test.info().outputPath(`table-${name}-share-${theme}-${viewport}.png`),
        clip: { x: Math.max(0, frame.x - 16), y: frame.y - 16, width: Math.min(frame.width + 32, VIEWPORTS[viewport].width), height: frame.height + 32 },
      });
    };

    // Phone: the table overflows, and column 1 stays at the left edge while the rest scrolls under it.
    await anonPage.setViewportSize(VIEWPORTS.mobile);
    expect(await wrapper.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect.poll(() => pinned(wrapper)).toBe(true);
    await shoot(wrapper, 'pinned-start', 'mobile');

    await wrapper.evaluate((el) => el.scrollTo({ left: el.scrollWidth / 2 }));
    await expect.poll(() => wrapper.evaluate((el) => el.hasAttribute('data-shade-start'))).toBe(true);
    const frame = await box(wrapper);
    const firstBox = await box(first);
    expect(Math.abs(firstBox.x - frame.x)).toBeLessThanOrEqual(1);
    expect(firstBox.width).toBeLessThanOrEqual(frame.width * 0.4 + 2);
    expect((await box(second)).x).toBeLessThan(frame.x);
    expect(
      await first.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('th, td') === el;
      }),
    ).toBe(true);
    const bodyCell = cfp.locator('tr').nth(1).locator('td').first();
    expect(await bodyCell.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    await shoot(wrapper, 'pinned-middle', 'mobile');

    await wrapper.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect.poll(() => wrapper.evaluate((el) => el.hasAttribute('data-shade-end'))).toBe(false);
    expect(Math.abs((await box(first)).x - frame.x)).toBeLessThanOrEqual(1);
    await shoot(wrapper, 'pinned-end', 'mobile');

    // A table that fits is not touched.
    expect(await shortWrapper.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await pinned(shortWrapper)).toBe(false);
    expect(await tables.nth(1).evaluate((el) => getComputedStyle(el).borderCollapse)).toBe('collapse');
    await shoot(shortWrapper, 'pinned-short', 'mobile');

    // Desktop: the table that fits is unchanged.
    await anonPage.setViewportSize(VIEWPORTS.desktop);
    expect(await pinned(shortWrapper)).toBe(false);
    await shoot(shortWrapper, 'pinned-short', 'desktop');
    await shoot(wrapper, 'pinned-cfp', 'desktop');
  });
}
