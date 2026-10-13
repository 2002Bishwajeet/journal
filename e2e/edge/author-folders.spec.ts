import { createServer, type Server } from 'node:http';
import { test, expect } from '../fixtures';

// #632: /share/<identity> lists the author's shared folders with their notes, then the
// notes shared one by one. Same local upstream fixture and port as author-index.spec.ts
// (the edge project runs one worker, so they never listen at once). The Function caches
// each identity's list, so every scenario uses its own identity.
test.skip(!!process.env.E2E_EDGE_BASE_URL, 'needs the local upstream fixture');

const WITH_FOLDER = 'with-folder.example.com';
const FOLDER_FAILS = 'folder-query-fails.example.com';
const SHARED = '33333333-3333-3333-3333-000000000001';
const PRIVATE = '33333333-3333-3333-3333-000000000002';
const id = (n: number) => `22222222-2222-2222-2222-${String(n).padStart(12, '0')}`;

// 3 notes in the shared folder, 1 individually public note in a private folder, 2 loose.
const NOTES: Record<number, { title: string; group: string; day: number }> = {
  1: { title: 'Folder note one', group: SHARED, day: 2 },
  2: { title: 'Folder note two', group: SHARED, day: 4 },
  3: { title: 'Folder note three', group: SHARED, day: 6 },
  4: { title: 'Public note in a private folder', group: PRIVATE, day: 8 },
  5: { title: 'Loose note one', group: '', day: 3 },
  6: { title: 'Loose note two', group: '', day: 9 },
};

let upstream: Server;
let folderQueryFails = false;

test.beforeAll(async () => {
  upstream = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:8799');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/pub/profile') return json(200, { name: 'Edge Author' });
    if (url.pathname !== '/api/guest/v1/drive/query/batch') return json(404, {});
    if (url.searchParams.get('fileType') === '606') {
      if (folderQueryFails) return json(500, {});
      return json(200, {
        searchResults: [
          {
            fileMetadata: {
              isEncrypted: false,
              appData: { uniqueId: SHARED, archivalStatus: 0, content: JSON.stringify({ name: 'Shared trips', isPublic: true }) },
            },
          },
        ],
      });
    }
    json(200, {
      searchResults: Object.entries(NOTES).map(([n, note]) => ({
        fileMetadata: {
          created: Date.UTC(2026, 1, note.day),
          updated: Date.UTC(2026, 1, note.day, 12),
          isEncrypted: false,
          appData: {
            uniqueId: id(Number(n)),
            ...(note.group ? { groupId: note.group } : {}),
            userDate: Date.UTC(2026, 1, note.day),
            archivalStatus: 0,
            content: JSON.stringify({ title: note.title, isPublic: true, card: { indexable: true } }),
          },
        },
      })),
    });
  });
  await new Promise<void>((resolve) => upstream.listen(8799, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => upstream?.close(resolve));
});

test.beforeEach(() => {
  folderQueryFails = false;
});

const links = (html: string) => [...html.matchAll(/<li><a href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);

test('the author page shows the shared folder with its notes, then the other notes', async ({ request, baseURL }) => {
  const res = await request.get(`/share/${WITH_FOLDER}`);
  expect(res.status()).toBe(200);
  const html = await res.text();

  expect(html).toContain(`<h3><a href="${baseURL}/share/${WITH_FOLDER}/f/${SHARED}">Shared trips</a></h3>`);
  expect(links(html)).toEqual([
    'Folder note three',
    'Folder note two',
    'Folder note one',
    'Loose note two',
    'Public note in a private folder',
    'Loose note one',
  ]);
  expect(html.indexOf('>Folders<')).toBeLessThan(html.indexOf('Shared trips'));
  expect(html.indexOf('Shared trips')).toBeLessThan(html.indexOf('>Notes<'));
  expect(html).not.toContain(PRIVATE);
  expect(html).not.toContain('All ');
});

test('the sitemap lists the folder page', async ({ request, baseURL }) => {
  const xml = await (await request.get(`/share/${WITH_FOLDER}/sitemap.xml`)).text();
  expect(xml).toContain(`<loc>${baseURL}/share/${WITH_FOLDER}/f/${SHARED}</loc>`);
  expect(xml).toContain(`/share/${WITH_FOLDER}/${id(5)}`);
});

test('a failing folder query falls back to the flat list, not a 404', async ({ request }) => {
  folderQueryFails = true;
  const res = await request.get(`/share/${FOLDER_FAILS}`);
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(links(html)).toHaveLength(6);
  expect(html).not.toContain('>Folders<');
});

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`the author page with a folder renders, ${theme} theme, ${viewport.width}px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize(viewport);
      await page.goto(`/share/${WITH_FOLDER}`);
      await expect(page.getByRole('heading', { level: 2, name: 'Folders' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 3, name: 'Shared trips' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Notes' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`author-folders-${theme}-${viewport.width}.png`), fullPage: true });
    });
  }
}
