import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { makeSolidPng } from '../support/png';

// #1387: every image on the share page holds its final box from the first paint, with
// the tiny thumbnail in it, so scrolling through a note while the images arrive moves
// nothing (cumulative layout shift stays under 0.01). The guest payloads are held back
// for a while so the placeholder phase can be seen and photographed; screenshots of the
// placeholder phase and the loaded phase, desktop and phone, both themes.
// Three images carry data-width / data-height in the note; the fourth is from before
// (no stored size) and takes its box from the payload descriptors in the file header.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } } as const;
const PAYLOAD_DELAY_MS = 2500;

const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '6a4d9c13-2e75-4b80-91f6-d3b8a0c75e21';
const FILE_ID = '1f7b3e90-5c24-4d68-a9e1-8c2d6b4f0a73';
const NOTE_TITLE = 'Images that hold their place';
const PUBLISHED = Date.UTC(2026, 10, 18, 9, 0);

const PICTURES = [
  { key: 'jrnl_img0', alt: 'Wide', width: 1600, height: 800, color: '#8fa3ad', stored: true },
  { key: 'jrnl_img1', alt: 'Tall', width: 600, height: 900, color: '#89a876', stored: true },
  { key: 'jrnl_img2', alt: 'Square', width: 900, height: 900, color: '#be785a', stored: true },
  { key: 'jrnl_img3', alt: 'Older', width: 1200, height: 600, color: '#9a8fbf', stored: false },
] as const;
type Picture = (typeof PICTURES)[number];

const svg = ({ width, height, color }: Picture) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`;
const TEXT = 'A paragraph of text between the pictures, so each one sits well below the one before it and the page is long enough to scroll through. '.repeat(8);

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string | number> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value as string);
  el.insert(0, children);
  return el;
}

function noteContent(): Buffer {
  const doc = new Y.Doc();
  const blocks: Y.XmlElement[] = [];
  for (const picture of PICTURES) {
    blocks.push(element('paragraph', [new Y.XmlText(TEXT)]));
    blocks.push(
      element('paragraph', [
        element('image', [], {
          src: `attachment://${FILE_ID}/${picture.key}`,
          alt: picture.alt,
          ...(picture.stored ? { naturalWidth: picture.width, naturalHeight: picture.height } : {}),
        }),
      ]),
    );
  }
  blocks.push(element('paragraph', [new Y.XmlText('The end.')]));
  doc.getXmlFragment('prosemirror').push(blocks);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

// The file header lists each image payload with its tiny thumbnail and thumbnail sizes
const tinyThumb = (picture: Picture) => ({
  contentType: 'image/png',
  content: makeSolidPng(20, Math.round((20 * picture.height) / picture.width), [143, 163, 173]).toString('base64'),
  pixelWidth: 20,
  pixelHeight: Math.round((20 * picture.height) / picture.width),
});

async function mockPublicNote(page: Page): Promise<void> {
  const header = {
    fileId: FILE_ID,
    fileSystemType: 'Standard',
    fileMetadata: {
      isEncrypted: false,
      updated: PUBLISHED,
      payloads: [
        { key: 'jrnl_txt' },
        ...PICTURES.map((picture) => ({
          key: picture.key,
          contentType: 'image/svg+xml',
          previewThumbnail: tinyThumb(picture),
          thumbnails: [{ contentType: 'image/webp', pixelWidth: picture.width, pixelHeight: picture.height }],
        })),
      ],
      appData: { uniqueId: NOTE_ID, userDate: PUBLISHED, archivalStatus: 0, content: JSON.stringify({ title: NOTE_TITLE }) },
    },
  };
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, async (route) => {
    const url = new URL(route.request().url());
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!url.pathname.endsWith('/payload')) {
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    }
    const picture = PICTURES.find((p) => p.key === url.searchParams.get('key'));
    if (!picture) return route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() });
    // The image bytes arrive late: the placeholder is what shows until then
    await new Promise((resolve) => setTimeout(resolve, PAYLOAD_DELAY_MS));
    return route.fulfill({ contentType: 'image/svg+xml', headers: { ...headers, decryptedcontenttype: 'image/svg+xml' }, body: svg(picture) });
  });
}

/** Starts summing the page's layout shifts (those not caused by input) from the first paint. */
async function watchLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) w.__cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}
const layoutShift = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);
// The page's own first render (the article replacing its skeleton) is not what is measured
const resetLayoutShift = (page: Page) => page.evaluate(() => ((window as unknown as { __cls: number }).__cls = 0));

const placeholders = (article: Locator) => article.getByTestId('image-placeholder');

/** Scrolls through the whole page in screen-sized steps. */
async function scrollThrough(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = page.viewportSize()!.height - 100;
  for (let y = 0; y < height; y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    // Nothing observable settles a scroll position; one frame is all a layout shift needs to show
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}

const tops = (page: Page) => page.evaluate(() => [...document.querySelectorAll('.share-img')].map((el) => Math.round(el.getBoundingClientRect().top + window.scrollY)));

for (const theme of THEMES) {
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    test(`share page: images hold their box while they load, ${theme} theme, ${name}`, async ({ anonPage }) => {
      await anonPage.emulateMedia({ colorScheme: theme });
      await anonPage.setViewportSize(viewport);
      await watchLayoutShift(anonPage);
      await mockPublicNote(anonPage);
      await anonPage.goto(`/share/${AUTHOR}/${NOTE_ID}`);
      await assertTestOrigin(anonPage);
      const article = anonPage.getByRole('article');
      await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });

      // Placeholder phase: every image already has its box, in its own aspect ratio, and no bytes yet
      await expect(placeholders(article)).toHaveCount(PICTURES.length);
      await expect(article.locator('.share-img img:not([aria-hidden="true"])')).toHaveCount(0);
      for (const [i, picture] of PICTURES.entries()) {
        const box = (await placeholders(article).nth(i).boundingBox())!;
        expect(box.width / box.height).toBeCloseTo(picture.width / picture.height, 1);
      }
      const before = await tops(anonPage);
      await resetLayoutShift(anonPage);
      await placeholders(article).first().scrollIntoViewIfNeeded();
      await anonPage.screenshot({ path: test.info().outputPath(`share-images-placeholder-${theme}-${name}.png`) });

      // Scroll through while the images arrive, then see that nothing below moved
      await scrollThrough(anonPage);
      for (const picture of PICTURES) {
        const loaded = article.getByRole('img', { name: picture.alt });
        await loaded.scrollIntoViewIfNeeded();
        await expect.poll(() => loaded.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth), { timeout: 20_000 }).toBe(picture.width);
      }
      await expect(placeholders(article)).toHaveCount(0);
      // Sub-pixel rounding aside, every image sits where its placeholder did
      (await tops(anonPage)).forEach((top, i) => expect(Math.abs(top - before[i])).toBeLessThanOrEqual(1));
      expect(await layoutShift(anonPage)).toBeLessThan(0.01);

      await article.getByRole('img', { name: PICTURES[0].alt }).scrollIntoViewIfNeeded();
      await anonPage.screenshot({ path: test.info().outputPath(`share-images-loaded-${theme}-${name}.png`) });
    });
  }
}
