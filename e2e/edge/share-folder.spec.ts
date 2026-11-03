import { createServer, type Server } from 'node:http';
import { test, expect } from '../fixtures';

// #619: functions/share/[[path]].ts renders /share/<identity>/f/<folderId>, a shared
// folder's public notes, from the author's guest drive: the folder file by its unique
// id (name) and the notes query filtered by groupId. `wrangler pages dev` points it at
// this fixture server through HOMEBASE_UPSTREAM_OVERRIDE (playwright.config.ts), the
// way author-index.spec.ts does, so these only run against the local edge server and
// share its port (the edge project runs one worker, so the two never listen at once).
// The Function caches each folder page (30 s, 60 s for a miss), so every scenario
// uses its own identity or folder.
test.skip(!!process.env.E2E_EDGE_BASE_URL, 'needs the local upstream fixture');

const IDENTITY = 'folders.example.com';
const FAILING = 'folder-failing.example.com';
const folderId = (n: number) => `33333333-3333-3333-3333-${String(n).padStart(12, '0')}`;
const noteId = (n: number) => `22222222-2222-2222-2222-${String(n).padStart(12, '0')}`;

const BLOG = folderId(1);
const EMPTY = folderId(2);
const UNSHARED = folderId(3);
const UNKNOWN = folderId(4);
const CARDED = folderId(5);
const CARD_NAMED_ONLY = folderId(6);

// Folder files the guest can read. UNSHARED is Owner-only on the server, so it is absent.
// `card` is what the content names (#644); `payload` whether the jrnl_card payload exists.
const FOLDERS: Record<string, { name: string; card?: object; payload?: boolean }> = {
  [BLOG]: { name: 'Blog' },
  [EMPTY]: { name: 'Empty folder' },
  [CARDED]: { name: 'Carded', card: { cardImageKey: 'jrnl_card', from: { name: 'Carded', count: 3 } }, payload: true },
  [CARD_NAMED_ONLY]: { name: 'Card lost', card: { cardImageKey: 'jrnl_card', from: { name: 'Card lost', count: 3 } } },
};

type Stub = { title: string; group: string; day: number; isEncrypted?: boolean; archivalStatus?: number };
// Three notes in Blog, one in another folder, one private and one trashed note in Blog.
const NOTES: Record<number, Stub> = {
  1: { title: 'Oldest post', group: BLOG, day: 3 },
  2: { title: 'Middle post', group: BLOG, day: 6 },
  3: { title: 'Newest post', group: BLOG, day: 9 },
  4: { title: 'Somewhere else', group: UNSHARED, day: 8 },
  5: { title: 'Private post', group: BLOG, day: 7, isEncrypted: true },
  6: { title: 'Trashed post', group: BLOG, day: 10, archivalStatus: 2 },
};

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
    if (url.pathname === '/api/guest/v1/drive/query/specialized/cuid/header') {
      if (failing) return json(500, {});
      const id = url.searchParams.get('clientUniqueId') ?? '';
      const folder = FOLDERS[id];
      if (!folder) return json(404, {});
      return json(200, {
        fileId: 'bbbbbbbb-0000-0000-0000-000000000001',
        fileMetadata: {
          isEncrypted: false,
          updated: 1_700_000_000_000,
          payloads: folder.payload ? [{ key: 'jrnl_card' }] : [],
          appData: { uniqueId: id, archivalStatus: 0, content: JSON.stringify({ name: folder.name, card: folder.card, isPublic: true }) },
        },
      });
    }
    if (url.pathname === '/api/guest/v1/drive/query/batch') {
      if (failing) return json(500, {});
      const groups = url.searchParams.getAll('groupId');
      return json(200, {
        cursorState: '',
        includeMetadataHeader: true,
        searchResults: Object.entries(NOTES)
          .filter(([, note]) => groups.length === 0 || groups.includes(note.group))
          .map(([n, note]) => ({
            fileId: `bbbbbbbb-0000-0000-0000-${n.padStart(12, '0')}`,
            fileMetadata: {
              created: Date.UTC(2026, 1, note.day),
              updated: Date.UTC(2026, 1, note.day, 12),
              isEncrypted: note.isEncrypted ?? false,
              appData: {
                uniqueId: noteId(Number(n)),
                groupId: note.group,
                userDate: Date.UTC(2026, 1, note.day),
                archivalStatus: note.archivalStatus ?? 0,
                content: note.isEncrypted
                  ? 'c2VjcmV0LWVuY3J5cHRlZC1jb250ZW50'
                  : JSON.stringify({ title: note.title, isPublic: true, card: { indexable: true } }),
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

test('a shared folder page lists its public notes, newest first, and each link opens the note page', async ({ request, baseURL }) => {
  const res = await request.get(`/share/${IDENTITY}/f/${BLOG}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/html');
  const html = await res.text();

  const links = [...html.matchAll(/<li><a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
  expect(links).toEqual([
    [`${baseURL}/share/${IDENTITY}/${noteId(3)}`, 'Newest post'],
    [`${baseURL}/share/${IDENTITY}/${noteId(2)}`, 'Middle post'],
    [`${baseURL}/share/${IDENTITY}/${noteId(1)}`, 'Oldest post'],
  ]);
  // Another folder's note, an encrypted one and a trashed one never show.
  for (const n of [4, 5, 6]) {
    expect(html).not.toContain(NOTES[n].title);
    expect(html).not.toContain(noteId(n));
  }
  expect(html).toContain('<time datetime="2026-02-09T00:00:00.000Z">February 9, 2026</time>');
  expect(html).toContain('<title>Blog · Journal</title>');
  expect(html).toContain(`<link rel="canonical" href="${baseURL}/share/${IDENTITY}/f/${BLOG}" />`);
  expect(html).toContain('property="og:title" content="Blog"');
  expect(html).toContain('property="og:site_name" content="Edge Author"');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('id="root"');

  // The note links are the SPA's note pages, as before.
  for (const [href] of links) {
    const note = await request.get(href);
    expect(note.status(), href).toBe(200);
    expect(await note.text(), href).toContain('id="root"');
  }
});

// #644: a folder whose file carries a card serves it as og:image; one without keeps the banner.
test('a shared folder page serves its own link card as og:image, and the banner without one', async ({ request, baseURL }) => {
  const carded = await (await request.get(`/share/${IDENTITY}/f/${CARDED}`)).text();
  const image = /property="og:image" content="([^"]+)"/.exec(carded)?.[1].replace(/&amp;/g, '&');
  const url = new URL(image ?? 'about:blank');
  expect(url.host).toBe(IDENTITY);
  expect(url.pathname).toBe('/api/guest/v1/drive/files/payload');
  expect(url.searchParams.get('fileId')).toBe('bbbbbbbb-0000-0000-0000-000000000001');
  expect(url.searchParams.get('key')).toBe('jrnl_card');
  expect(url.searchParams.get('v')).toBe('1700000000000');
  expect(carded).toContain('property="og:image:width" content="1200"');
  expect(carded).toContain('property="og:image:height" content="630"');
  expect(carded).toContain('name="twitter:card" content="summary_large_image"');

  // No card at all, or one the content names whose payload is gone: the banner.
  for (const id of [BLOG, CARD_NAMED_ONLY]) {
    const html = await (await request.get(`/share/${IDENTITY}/f/${id}`)).text();
    expect(html, id).toContain(`property="og:image" content="${baseURL}/banner.webp"`);
    expect(html, id).toContain('name="twitter:card" content="summary"');
  }

  // The author page is unchanged.
  const index = await (await request.get(`/share/${IDENTITY}`)).text();
  expect(index).toContain(`property="og:image" content="${baseURL}/banner.webp"`);
  expect(index).toContain('name="twitter:card" content="summary"');
});

test('the author index and a note page are served as before', async ({ request }) => {
  const index = await request.get(`/share/${IDENTITY}`);
  expect(index.status()).toBe(200);
  const html = await index.text();
  expect(html).toContain('<title>Notes by Edge Author · Journal</title>');
  // The author index lists every folder's notes, not just one.
  expect(html).toContain('Somewhere else');
  expect(html).toContain('Newest post');

  const note = await request.get(`/share/${IDENTITY}/${noteId(3)}`);
  expect(note.status()).toBe(200);
  expect(await note.text()).toContain('id="root"');
});

test('a shared folder with no public notes says so', async ({ request }) => {
  const res = await request.get(`/share/${IDENTITY}/f/${EMPTY}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('<h1 class="serif">Empty folder</h1>');
  // The stub's query is filtered by groupId, and no note is in this folder.
  expect(html).toContain('No public notes listed.');
});

test('an unshared or unknown folder is a 404, not the SPA shell', async ({ request }) => {
  for (const path of [
    `/share/${IDENTITY}/f/${UNSHARED}`,
    `/share/${IDENTITY}/f/${UNKNOWN}`,
    `/share/${IDENTITY}/f/not-a-guid`,
    `/share/localhost/f/${BLOG}`,
  ]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(404);
    expect(await res.text(), path).not.toContain('id="root"');
  }
});

test('an upstream failure is a 404, not the SPA shell', async ({ request }) => {
  failing = true;
  const res = await request.get(`/share/${FAILING}/f/${BLOG}`);
  expect(res.status()).toBe(404);
  expect(await res.text()).not.toContain('id="root"');
});

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`the folder page renders, ${theme} theme, ${viewport.width}px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize(viewport);
      await page.goto(`/share/${IDENTITY}/f/${BLOG}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Blog' })).toBeVisible();
      await expect(page.getByRole('listitem')).toHaveCount(3);
      const href = await page.getByRole('link', { name: 'Newest post' }).getAttribute('href');
      expect(href?.endsWith(`/share/${IDENTITY}/${noteId(3)}`)).toBe(true);
      const logo = page.getByRole('banner').locator('img');
      await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`folder-page-${theme}-${viewport.width}.png`), fullPage: true });
    });
  }
}
