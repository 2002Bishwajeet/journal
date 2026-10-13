import { createServer, type Server } from 'node:http';
import { test, expect } from '../fixtures';

// #639: a note whose card says `unlisted` is public by link only: it is left off the
// author page, its folder's page and the sitemap, and its own page is noindex. Same
// upstream fixture approach as author-index.spec.ts (shares its port, own identity).
test.skip(!!process.env.E2E_EDGE_BASE_URL, 'needs the local upstream fixture');

const IDENTITY = 'unlisted.example.com';
const noteId = (n: number) => `22222222-2222-2222-2222-${String(n).padStart(12, '0')}`;
const BLOG = '33333333-3333-3333-3333-000000000001';

type Stub = { title: string; card: object; group?: string; day: number };
// 1 listed loose, 2 unlisted loose, 3 listed in Blog, 4 unlisted in Blog (indexable switch still on).
const NOTES: Record<number, Stub> = {
  1: { title: 'Listed loose', card: { indexable: true }, day: 5 },
  2: { title: 'Unlisted loose', card: { indexable: true, unlisted: true }, day: 6 },
  3: { title: 'Listed in blog', card: { indexable: true }, group: BLOG, day: 7 },
  4: { title: 'Unlisted in blog', card: { indexable: true, unlisted: true }, group: BLOG, day: 8 },
};

let upstream: Server;

const file = (n: number, note: Stub) => ({
  fileId: `bbbbbbbb-0000-0000-0000-${String(n).padStart(12, '0')}`,
  fileMetadata: {
    created: Date.UTC(2026, 1, note.day),
    updated: Date.UTC(2026, 1, note.day, 12),
    isEncrypted: false,
    appData: {
      uniqueId: noteId(n),
      ...(note.group && { groupId: note.group }),
      userDate: Date.UTC(2026, 1, note.day),
      archivalStatus: 0,
      content: JSON.stringify({ title: note.title, isPublic: true, card: note.card }),
    },
  },
});

test.beforeAll(async () => {
  upstream = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:8799');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/pub/profile') return json(200, { name: 'Edge Author' });
    if (url.pathname === '/api/guest/v1/drive/query/specialized/cuid/header') {
      const id = url.searchParams.get('clientUniqueId') ?? '';
      if (id === BLOG) {
        return json(200, {
          fileId: 'bbbbbbbb-0000-0000-0000-00000000f001',
          fileMetadata: { isEncrypted: false, appData: { uniqueId: id, archivalStatus: 0, content: JSON.stringify({ name: 'Blog', isPublic: true }) } },
        });
      }
      const n = Object.keys(NOTES).map(Number).find((k) => noteId(k) === id);
      return n ? json(200, file(n, NOTES[n])) : json(404, {});
    }
    if (url.pathname === '/api/guest/v1/drive/query/batch') {
      const groups = url.searchParams.getAll('groupId');
      return json(200, {
        cursorState: '',
        includeMetadataHeader: true,
        searchResults: Object.entries(NOTES)
          .filter(([, note]) => groups.length === 0 || (note.group && groups.includes(note.group)))
          .map(([n, note]) => file(Number(n), note)),
      });
    }
    json(404, {});
  });
  await new Promise<void>((resolve) => upstream.listen(8799, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => upstream?.close(resolve));
});

test('unlisted notes are off the author page, the folder page and the sitemap', async ({ request }) => {
  const index = await (await request.get(`/share/${IDENTITY}`)).text();
  expect(index).toContain('Listed loose');
  expect(index).toContain('Listed in blog');
  for (const n of [2, 4]) {
    expect(index).not.toContain(NOTES[n].title);
    expect(index).not.toContain(noteId(n));
  }

  const folder = await request.get(`/share/${IDENTITY}/f/${BLOG}`);
  expect(folder.status()).toBe(200);
  const folderHtml = await folder.text();
  expect(folderHtml).toContain('Listed in blog');
  expect(folderHtml).not.toContain('Unlisted in blog');
  expect(folderHtml).not.toContain(noteId(4));

  const xml = await (await request.get(`/share/${IDENTITY}/sitemap.xml`)).text();
  expect(xml).toContain(noteId(1));
  expect(xml).toContain(noteId(3));
  expect(xml).not.toContain(noteId(2));
  expect(xml).not.toContain(noteId(4));
});

test('an unlisted note still opens, and its page is noindex', async ({ request }) => {
  for (const n of [2, 4]) {
    const res = await request.get(`/share/${IDENTITY}/${noteId(n)}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['x-robots-tag']).toBe('noindex');
    const html = await res.text();
    expect(html).toContain('id="root"');
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain(NOTES[n].title);
  }
  const listed = await request.get(`/share/${IDENTITY}/${noteId(1)}`);
  expect(listed.status()).toBe(200);
  expect(listed.headers()['x-robots-tag']).toBeUndefined();
});
