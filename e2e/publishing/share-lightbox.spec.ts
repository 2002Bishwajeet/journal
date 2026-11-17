import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { THEMES } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #1357: on the share page every gallery shows its images whole (a grid tile is no
// longer a square crop), and a tap opens an image full size in the lightbox; Esc
// closes it. A drag across the carousel doesn't open it. Same canned public-note
// setup as share-gallery.spec.ts; screenshots at 1280 and 390, light and dark.

const VIEWPORTS = [
  [1280, { width: 1280, height: 900 }],
  [390, { width: 390, height: 844 }],
] as const;

const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '3c8e1f5a-6b2d-4a97-9e01-7d4c2b8f6a13';
const FILE_ID = '9b2d4f71-5e3a-4c86-a1f0-2e7c9d3b5a64';
const NOTE_TITLE = 'Photos, whole';
const PUBLISHED = Date.UTC(2026, 10, 17, 9, 0);

const picture = (width: number, height: number, fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/><rect x="6" y="6" width="${width - 12}" height="${height - 12}" fill="none" stroke="#1f2a30" stroke-width="12"/><text x="24" y="48" font-family="sans-serif" font-size="24" fill="#1f2a30">${width} x ${height}</text></svg>`;
// The grid's three, then a very wide and a very tall carousel slide.
const IMAGES = [
  { alt: 'Wide', width: 900, height: 450, fill: '#8fa3ad' },
  { alt: 'Tall', width: 600, height: 800, fill: '#718968' },
  { alt: 'Square', width: 700, height: 700, fill: '#be785a' },
  { alt: 'Panorama', width: 1600, height: 200, fill: '#c9b37a' },
  { alt: 'Tower', width: 300, height: 1200, fill: '#9a86b0' },
];
const PICTURES = Object.fromEntries(IMAGES.map((img, i) => [`jrnl_img${i}`, picture(img.width, img.height, img.fill)]));

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.insert(0, children);
  return el;
}

const images = (from: number, to: number) =>
  IMAGES.slice(from, to).map(({ alt }, i) => element('image', [], { src: `attachment://${FILE_ID}/jrnl_img${from + i}`, alt }));

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([
    element('paragraph', [new Y.XmlText('A grid of three.')]),
    element('gallery', images(0, 3), { layout: 'grid' }),
    element('paragraph', [new Y.XmlText('And a carousel.')]),
    element('gallery', images(3, 5), { layout: 'carousel' }),
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
    const svg = PICTURES[url.searchParams.get('key') ?? ''];
    return svg
      ? route.fulfill({ contentType: 'image/svg+xml', headers: { ...headers, decryptedcontenttype: 'image/svg+xml' }, body: svg })
      : route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() });
  });
}

/** The image is drawn whole: its box keeps the natural aspect ratio and lies inside the viewport. */
const shownWhole = (img: Locator) =>
  img.evaluate((el: HTMLImageElement) => {
    const r = el.getBoundingClientRect();
    const ratio = el.naturalWidth / el.naturalHeight;
    return (
      el.complete &&
      el.naturalWidth > 0 &&
      Math.abs(r.width / r.height - ratio) < 0.03 * ratio &&
      r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
    );
  });

/** Contained, and its box fits the carousel strip's height and width, so nothing of it is clipped. */
const fitsCarousel = (img: Locator) =>
  img.evaluate((el: HTMLImageElement) => {
    const strip = el.closest('[data-gallery]')!.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).objectFit === 'contain' && r.top >= strip.top - 1 && r.bottom <= strip.bottom + 1 && r.width <= strip.width + 1;
  });

// Each theme is its own load here; the live flip is in share-theme-live.spec.ts.
for (const theme of THEMES) test(`share page: galleries show images whole, and a tap opens one full size, ${theme} theme`, async ({ anonPage: page }) => {
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize(VIEWPORTS[0][1]);
  await mockPublicNote(page);
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  await expect(page.locator('html')).toHaveClass(new RegExp(theme));
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });

  const grid = article.locator('[data-gallery="grid"]');
  const carousel = article.locator('[data-gallery="carousel"]');
  for (const { alt } of IMAGES) {
    await expect.poll(() => article.getByRole('img', { name: alt }).evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  }
  const dialog = page.getByRole('dialog');
  const shoot = (name: string, width: number) => page.screenshot({ path: test.info().outputPath(`share-lightbox-${name}-${theme}-${width}.png`) });

  for (const [width, size] of VIEWPORTS) {
    await page.setViewportSize(size);

    // Grid: each tile shows the whole image, contained in its square on a muted ground.
    for (const { alt } of IMAGES.slice(0, 3)) {
      const img = grid.getByRole('img', { name: alt });
      expect(await img.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
      await expect.poll(async () => {
        const box = (await img.boundingBox())!;
        return Math.abs(box.width - box.height) < 2;
      }).toBe(true);
    }
    await grid.scrollIntoViewIfNeeded();
    await shoot('grid', width);
    // The other choice the issue names, for comparison: cells that follow each image's ratio.
    const ratioCells = await page.addStyleTag({
      content: ".prose [data-gallery='grid'] { align-items: start; } .prose [data-gallery='grid'] img:not(.h-full) { aspect-ratio: auto !important; background: none !important; }",
    });
    await shoot('grid-ratio-cells', width);
    await ratioCells.evaluate((el) => el.remove());

    // Carousel: the very wide and very tall slides are letterboxed, never clipped.
    for (const { alt } of IMAGES.slice(3)) expect(await fitsCarousel(carousel.getByRole('img', { name: alt }))).toBe(true);
    await article.locator('.gallery-nav').scrollIntoViewIfNeeded();
    await shoot('carousel', width);

    // A grid tile opens whole; Esc closes.
    await grid.getByRole('button', { name: 'Tall, view full size' }).click();
    const tall = dialog.getByRole('img', { name: 'Tall' });
    await expect(tall).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => shownWhole(tall)).toBe(true);
    await shoot('open-grid', width);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // A drag across the carousel opens nothing; its buttons still work, then a tap opens the slide.
    const block = article.getByRole('group', { name: 'Image gallery' });
    const slide = carousel.getByRole('button', { name: 'Panorama, view full size' });
    const at = (await slide.boundingBox())!;
    await page.mouse.move(at.x + at.width * 0.8, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(at.x + at.width * 0.2, at.y + at.height / 2, { steps: 8 });
    await page.mouse.up();
    await block.getByRole('button', { name: 'Next image' }).click();
    await expect(dialog).toHaveCount(0);
    await block.getByRole('button', { name: 'Show image 1 of 2' }).click();
    await expect.poll(() => carousel.evaluate((el) => Math.round(el.scrollLeft / el.clientWidth))).toBe(0);

    await slide.click();
    const panorama = dialog.getByRole('img', { name: 'Panorama' });
    await expect.poll(() => shownWhole(panorama)).toBe(true);
    await shoot('open-carousel', width);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});
