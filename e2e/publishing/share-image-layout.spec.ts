import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #581: an image's width and float alignment (set in the editor, stored as node
// attrs) reach the share page: a 320px right-floated image is 320px and floated
// right on desktop, and a full block on a phone. Same canned public-note setup
// as share-wide-blocks.spec.ts; screenshots in both themes.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;

const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '3b8f6a21-5c4e-4d77-9a10-e2c7d1f0b684';
const FILE_ID = '9d2e5f13-6a48-4b0c-8e71-0c3a7b1d4f92';
const NOTE_TITLE = 'Image layout on the share page';
const PUBLISHED = Date.UTC(2026, 9, 12, 9, 0);

const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><rect width="800" height="400" fill="#8fa3ad"/><text x="24" y="48" font-family="sans-serif" font-size="24" fill="#1f2a30">800 x 400</text></svg>`;
const TEXT = 'Text wraps beside a floated image, so the picture sits in the margin while the sentence keeps going. '.repeat(6);

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string | number> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value as string);
  el.insert(0, children);
  return el;
}

const image = (alt: string, attributes: Record<string, string | number>) =>
  element('paragraph', [element('image', [], { src: `attachment://${FILE_ID}/jrnl_img0`, alt, ...attributes })]);

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([
    image('Right', { width: 320, align: 'right' }),
    element('paragraph', [new Y.XmlText(TEXT)]),
    image('Plain', {}),
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
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const url = new URL(route.request().url());
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!url.pathname.endsWith('/payload')) {
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    }
    return url.searchParams.get('key') === 'jrnl_img0'
      ? route.fulfill({ contentType: 'image/svg+xml', headers: { ...headers, decryptedcontenttype: 'image/svg+xml' }, body: PICTURE })
      : route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() });
  });
}

async function openNote(page: Page): Promise<Locator> {
  await mockPublicNote(page);
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  for (const alt of ['Right', 'Plain']) {
    const picture = article.getByRole('img', { name: alt });
    await picture.scrollIntoViewIfNeeded();
    await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(800);
  }
  return article;
}

const box = async (locator: Locator) => (await locator.boundingBox())!;

for (const theme of THEMES) {
  test(`share page: an image keeps its width and float, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize(VIEWPORTS.desktop);
    const article = await openNote(anonPage);
    const right = article.getByRole('img', { name: 'Right' });
    const plain = article.getByRole('img', { name: 'Plain' });
    const floatOf = (picture: Locator) => picture.evaluate((el) => getComputedStyle(el.closest('.share-img')!).float);

    // Desktop: 320px wide, floated right, the text beside it.
    expect((await box(right)).width).toBeCloseTo(320, 0);
    expect(await floatOf(right)).toBe('right');
    const column = await box(article.getByText(TEXT.slice(0, 40)));
    const rightBox = await box(right);
    expect(rightBox.x + rightBox.width).toBeLessThanOrEqual(column.x + column.width + 0.5);
    expect(rightBox.x).toBeGreaterThan(column.x + column.width / 2);
    // An image with neither is unchanged: the full column, no float.
    expect(await floatOf(plain)).toBe('none');
    expect((await box(plain)).width).toBeGreaterThan(320);
    await anonPage.screenshot({ path: test.info().outputPath(`share-image-layout-${theme}-1280.png`) });

    // Phone: no float, and the image is no wider than the column.
    await anonPage.setViewportSize(VIEWPORTS.mobile);
    expect(await floatOf(right)).toBe('none');
    const phoneColumn = await box(article.getByText(TEXT.slice(0, 40)));
    expect((await box(right)).width).toBeLessThanOrEqual(phoneColumn.width + 0.5);
    expect(await anonPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await anonPage.screenshot({ path: test.info().outputPath(`share-image-layout-${theme}-390.png`) });
  });
}
