import { createServer, type Server } from 'node:http';
import { test, expect } from '../fixtures';

// #515: functions/share/[[path]].ts renders /share/<identity> (HTML) and
// /share/<identity>/sitemap.xml from the author's guest drive query.
// `wrangler pages dev` points it at this fixture server through the
// HOMEBASE_UPSTREAM_OVERRIDE binding (playwright.config.ts), so these only run
// against the local edge server. share-og.spec.ts uses the same port; the edge
// project runs one worker locally, so the two never listen at once.
// The Function caches each identity's list (5 min, 60 s for a miss), so every
// scenario uses its own identity.
test.skip(!!process.env.E2E_EDGE_BASE_URL, 'needs the local upstream fixture');

const MIXED = 'mixed.example.com';
const FAILING = 'failing.example.com';
const id = (n: number) => `22222222-2222-2222-2222-${String(n).padStart(12, '0')}`;

type Stub = { title: string; card?: object; isEncrypted?: boolean; archivalStatus?: number; day: number };

// The guest drive, mixed: two indexable notes, one switched to noindex, one
// published before indexing was a choice, a private (encrypted) one and a trashed one.
const NOTES: Record<number, Stub> = {
  1: { title: 'Older indexable note', card: { indexable: true }, day: 5 },
  2: { title: 'Newer indexable note', card: { indexable: true, description: 'D' }, day: 9 },
  3: { title: 'Noindex note', card: { indexable: false }, day: 7 },
  4: { title: 'Old card note', card: { description: 'no indexable flag' }, day: 6 },
  5: { title: 'Private note', isEncrypted: true, day: 8 },
  6: { title: 'Trashed note', card: { indexable: true }, archivalStatus: 2, day: 10 },
};
const UNLISTED = [5, 6];
const NOT_IN_SITEMAP = [3, 4, 5, 6];

let upstream: Server;
let failing = false;

test.beforeAll(async () => {
  upstream = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:8799');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/pub/profile') return json(200, { name: 'Edge Author' });
    if (url.pathname === '/api/guest/v1/drive/query/batch') {
      if (failing) return json(500, {});
      return json(200, {
        cursorState: '',
        includeMetadataHeader: true,
        searchResults: Object.entries(NOTES).map(([n, note]) => ({
          fileId: `bbbbbbbb-0000-0000-0000-${n.padStart(12, '0')}`,
          fileMetadata: {
            created: Date.UTC(2026, 1, note.day),
            updated: Date.UTC(2026, 1, note.day, 12),
            isEncrypted: note.isEncrypted ?? false,
            appData: {
              uniqueId: id(Number(n)),
              userDate: Date.UTC(2026, 1, note.day),
              archivalStatus: note.archivalStatus ?? 0,
              content: note.isEncrypted
                ? 'c2VjcmV0LWVuY3J5cHRlZC1jb250ZW50'
                : JSON.stringify({ title: note.title, isPublic: true, card: note.card }),
            },
          },
        })),
      });
    }
    json(404, {});
  });
  await new Promise<void>((resolve) => upstream.listen(8799, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => upstream?.close(resolve));
});

test.beforeEach(() => {
  failing = false;
});

test('the author index lists every public note, newest first, even those hidden from search engines', async ({ request, baseURL }) => {
  const res = await request.get(`/share/${MIXED}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/html');
  const html = await res.text();

  const links = [...html.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  expect(links).toEqual([
    [`${baseURL}/share/${MIXED}/${id(2)}`, 'Newer indexable note'],
    [`${baseURL}/share/${MIXED}/${id(3)}`, 'Noindex note'],
    [`${baseURL}/share/${MIXED}/${id(4)}`, 'Old card note'],
    [`${baseURL}/share/${MIXED}/${id(1)}`, 'Older indexable note'],
  ]);
  for (const n of UNLISTED) {
    expect(html).not.toContain(NOTES[n].title);
    expect(html).not.toContain(id(n));
  }
  expect(html).toContain('<time datetime="2026-02-09T00:00:00.000Z">February 9, 2026</time>');
  expect(html).toContain('<title>Notes by Edge Author · Journal</title>');
  expect(html).toContain(`<link rel="canonical" href="${baseURL}/share/${MIXED}" />`);
  expect(html).toContain('property="og:title" content="Notes by Edge Author"');
  expect(html).toContain(`property="og:url" content="${baseURL}/share/${MIXED}"`);
  expect(html).not.toContain('noindex');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('id="root"');
});

test('the sitemap lists only the indexable notes, with lastmod', async ({ request, baseURL }) => {
  const res = await request.get(`/share/${MIXED}/sitemap.xml`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/xml');
  const xml = await res.text();

  expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  const urls = [...xml.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)].map((m) => [m[1], m[2]]);
  expect(urls).toEqual([
    [`${baseURL}/share/${MIXED}/${id(2)}`, '2026-02-09T12:00:00.000Z'],
    [`${baseURL}/share/${MIXED}/${id(1)}`, '2026-02-05T12:00:00.000Z'],
  ]);
  expect(xml.match(/<url>/g)).toHaveLength(2);
  for (const n of NOT_IN_SITEMAP) expect(xml).not.toContain(id(n));
});

test('an upstream failure is a 404, not the SPA shell', async ({ request }) => {
  failing = true;
  for (const path of [`/share/${FAILING}`, `/share/${FAILING}/sitemap.xml`]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
    expect(await res.text()).not.toContain('id="root"');
  }
});

test('an invalid identity is a 404, not the SPA shell', async ({ request }) => {
  for (const path of ['/share/localhost', '/share/localhost/sitemap.xml']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
    expect(await res.text()).not.toContain('id="root"');
  }
});

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`the author index renders, ${theme} theme, ${viewport.width}px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize(viewport);
      await page.goto(`/share/${MIXED}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Edge Author' })).toBeVisible();
      await expect(page.getByRole('listitem')).toHaveCount(4);
      await expect(page.getByRole('link', { name: 'Newer indexable note' })).toHaveAttribute('href', new RegExp(`/share/${MIXED.replaceAll('.', '\\.')}/${id(2)}$`));
      const logo = page.getByRole('banner').locator('img');
      await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`author-index-${theme}-${viewport.width}.png`), fullPage: true });
    });
  }
}
