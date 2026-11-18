import type { Locator } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #1384: on the share page a table whose cells hold long bare URLs fits the note
// column the same way it does in the editor (e2e/editor/table-long-urls.spec.ts).
// Screenshots: desktop and phone, light and dark.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;
const SLACK = 0.5;

const HEADER = ['Conference', 'City', 'Dates', 'Format', 'Apply', 'Fit', 'Status'];
const ROWS = [
  ['Rootconf', 'Pune', 'May', 'Talk', 'https://hasgeek.com/rootconf/call-for-submissions-distributed-systems-workshops/', 'High', 'Open'],
  ['FOSSASIA', 'Bangkok', 'March', 'Workshop', 'https://eventyay.com/e/fossasia-summit-2026/cfs/call-for-proposals-open-source', 'Medium', 'Sent'],
];
const URLS = ROWS.map((row) => row[4]);

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

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([
    paragraph([new Y.XmlText(INTRO)]),
    element(
      'table',
      [HEADER, ...ROWS].map((cells, r) => element('tableRow', cells.map((value) => cell(r === 0 ? 'tableHeader' : 'tableCell', value)))),
    ),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

const box = async (locator: Locator) => {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
};

for (const theme of THEMES) {
  test(`share page: a table with long URLs fits the note column, ${theme} theme`, async ({ anonPage }) => {
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
    const table = article.getByRole('table');
    await expect(table.locator('th')).toHaveCount(HEADER.length);
    const wrapper = table.locator('xpath=..');

    for (const viewport of ['desktop', 'mobile'] as const) {
      await anonPage.setViewportSize(VIEWPORTS[viewport]);
      const text = await box(article.getByText(INTRO));
      const frame = await box(wrapper);
      expect(frame.x + frame.width).toBeLessThanOrEqual(text.x + text.width + SLACK);

      if (viewport === 'desktop') {
        expect(await wrapper.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        const last = await box(table.locator('th').last());
        expect(last.x + last.width).toBeLessThanOrEqual(text.x + text.width + SLACK);
        for (const url of URLS) expect((await box(table.getByRole('link', { name: url }))).height).toBeGreaterThan(30);
        for (const word of ['High', 'Open']) {
          expect((await box(table.getByRole('cell', { name: word, exact: true }))).height).toBeLessThan(45);
        }
      }
      expect(await anonPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await wrapper.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const shot = await box(wrapper);
      await anonPage.screenshot({
        path: test.info().outputPath(`table-long-urls-share-${theme}-${viewport}.png`),
        clip: { x: Math.max(0, shot.x - 16), y: shot.y - 16, width: Math.min(shot.width + 32, VIEWPORTS[viewport].width), height: shot.height + 32 },
      });
    }
  });
}
