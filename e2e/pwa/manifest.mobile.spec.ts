import { test, expect } from '../fixtures';

// #855: the install manifest has an identity, install-dialog screenshots,
// categories, one description and a maskable icon.

type Image = { src: string; sizes: string; type: string; purpose?: string; form_factor?: string };

const attr = (html: string, pattern: RegExp) => html.match(pattern)?.[1];

test('the manifest and head tags describe an installable app', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const manifestHref = attr(html, /<link rel="manifest" href="([^"]+)"/)!;
  expect(manifestHref).toBeTruthy();
  const manifest = await (await request.get(manifestHref)).json();

  expect(manifest.id).toBe('/');
  expect(manifest.start_url).toBe('/');
  expect(manifest.scope).toBe('/');
  expect(manifest.categories).toEqual(['productivity', 'utilities']);
  expect(manifest.description.length).toBeLessThanOrEqual(120);
  expect(attr(html, /<meta name="description" content="([^"]+)"/)).toBe(manifest.description);
  expect(attr(html, /<meta property="og:description" content="([^"]+)"/)).toBe(manifest.description);
  expect(attr(html, /<meta name="twitter:description" content="([^"]+)"/)).toBe(manifest.description);
  expect(attr(html, /<meta name="apple-mobile-web-app-title" content="([^"]+)"/)).toBe('Journal');

  const screenshots: Image[] = manifest.screenshots;
  expect(screenshots.some((s) => s.form_factor === 'narrow')).toBe(true);
  expect(screenshots.some((s) => s.form_factor === 'wide')).toBe(true);
  const icons: Image[] = manifest.icons;
  expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
  expect(icons.filter((i) => !i.purpose || i.purpose === 'any').length).toBeGreaterThanOrEqual(2);

  for (const image of [...screenshots, ...icons]) {
    const res = await request.get(new URL(image.src, new URL(manifestHref, 'http://x/')).pathname);
    expect(res.status(), image.src).toBe(200);
    const bytes = await res.body();
    // A PNG's IHDR chunk holds the width and height at bytes 16 to 24.
    expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, image.src).toBe(image.sizes);
  }
});
