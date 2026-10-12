import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #601: a row gallery reaches the share page: three images side by side at one
// height on desktop, two per row at 390px (never one column). Same canned
// public-note setup as share-image-layout.spec.ts; screenshots in both themes.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;

const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '5a1c7e42-8d3b-4f60-b2a9-1e6d0c4f8a37';
const FILE_ID = '7e3f9a26-1b5c-4d84-a0e7-3c9b2d6f1e58';
const NOTE_TITLE = 'A gallery on the share page';
const PUBLISHED = Date.UTC(2026, 9, 12, 9, 0);

const picture = (width: number, height: number, fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/><text x="24" y="48" font-family="sans-serif" font-size="24" fill="#1f2a30">${width} x ${height}</text></svg>`;
const PICTURES: Record<string, string> = {
  jrnl_img0: picture(900, 450, '#8fa3ad'),
  jrnl_img1: picture(600, 800, '#718968'),
  jrnl_img2: picture(700, 700, '#be785a'),
};
const ALTS = ['Wide', 'Tall', 'Square'];

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.insert(0, children);
  return el;
}

function noteContent(edited = false): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([
    element('paragraph', [new Y.XmlText('Three photos from the trip.')]),
    element(
      'gallery',
      ALTS.map((alt, i) => element('image', [], { src: `attachment://${FILE_ID}/jrnl_img${i}`, alt, ...(i === 1 ? { caption: 'The pier' } : {}), ...(edited && i === 0 ? { crop: { x: 0, y: 0, w: 0.5, h: 1 } } : {}), ...(edited && i === 1 ? { rotate: 90 } : {}) })),
      { layout: 'row' },
    ),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function mockPublicNote(page: Page, edited = false): Promise<void> {
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
    const svg = PICTURES[url.searchParams.get('key') ?? ''];
    return svg
      ? route.fulfill({ contentType: 'image/svg+xml', headers: { ...headers, decryptedcontenttype: 'image/svg+xml' }, body: svg })
      : route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent(edited) });
  });
}

const box = async (locator: Locator) => (await locator.boundingBox())!;
const near = (a: number, b: number) => Math.abs(a - b) < 2;

for (const theme of THEMES) {
  test(`share page: a gallery is one row, two per row on a phone, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize(VIEWPORTS.desktop);
    await mockPublicNote(anonPage);
    await anonPage.goto(`/share/${AUTHOR}/${NOTE_ID}`);
    await assertTestOrigin(anonPage);
    const article = anonPage.getByRole('article');
    await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });

    const gallery = article.locator('[data-gallery="row"]');
    await expect(gallery).toHaveCount(1);
    const images = ALTS.map((alt) => gallery.getByRole('img', { name: alt }));
    for (const img of images) {
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
    }
    await expect(gallery.getByTestId('share-image-caption')).toHaveText(['Wide', 'The pier', 'Square']);

    // Desktop: one row, one height, widths by aspect ratio
    await expect.poll(async () => {
      const [a, b, c] = await Promise.all(images.map(box));
      return near(a.y, b.y) && near(a.y, c.y) && near(a.height, b.height) && near(a.height, c.height);
    }).toBe(true);
    const wide = await box(images[0]);
    expect(wide.width / wide.height).toBeCloseTo(2, 1);
    await gallery.scrollIntoViewIfNeeded();
    await anonPage.screenshot({ path: test.info().outputPath(`share-gallery-${theme}-1280.png`) });

    // Phone: the first two side by side, the third on the next row
    await anonPage.setViewportSize(VIEWPORTS.mobile);
    await expect.poll(async () => {
      const [a, b, c] = await Promise.all(images.map(box));
      return near(a.y, b.y) && b.x > a.x + a.width && c.y > a.y + a.height;
    }).toBe(true);
    expect(await anonPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await gallery.scrollIntoViewIfNeeded();
    await anonPage.screenshot({ path: test.info().outputPath(`share-gallery-${theme}-390.png`) });
  });
}

// #607: a cropped (1:1) and a quarter-turned image keep their row's height.
for (const theme of THEMES) {
  test(`share page: edited gallery images share a row height, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize(VIEWPORTS.desktop);
    await mockPublicNote(anonPage, true);
    await anonPage.goto(`/share/${AUTHOR}/${NOTE_ID}`);
    await assertTestOrigin(anonPage);
    const article = anonPage.getByRole('article');
    await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });

    const gallery = article.locator('[data-gallery="row"]');
    const frames = gallery.getByTestId('edited-image');
    await expect(frames).toHaveCount(2);
    const square = gallery.getByRole('img', { name: 'Square' });
    await expect.poll(() => square.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);

    await expect.poll(async () => {
      const [a, b, c] = [await box(frames.nth(0)), await box(frames.nth(1)), await box(square)];
      return near(a.y, b.y) && near(a.y, c.y) && near(a.height, b.height) && near(a.height, c.height) && near(a.width / a.height, 1) && near(b.width / b.height, 4 / 3);
    }).toBe(true);
    await gallery.scrollIntoViewIfNeeded();
    await anonPage.screenshot({ path: test.info().outputPath(`share-gallery-edited-${theme}-1280.png`) });

    await anonPage.setViewportSize(VIEWPORTS.mobile);
    await expect.poll(async () => {
      const [a, b] = [await box(frames.nth(0)), await box(frames.nth(1))];
      return near(a.y, b.y) && near(a.height, b.height) && b.x > a.x + a.width;
    }).toBe(true);
    await gallery.scrollIntoViewIfNeeded();
    await anonPage.screenshot({ path: test.info().outputPath(`share-gallery-edited-${theme}-390.png`) });
  });
}
