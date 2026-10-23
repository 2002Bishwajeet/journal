import { createServer, type Server } from 'node:http';
import { test, expect } from '../fixtures';

// #671: every page is served with a Content-Security-Policy-Report-Only header and no
// enforcing one. The app shell (`/`, any SPA route, a note share page, plain or rewritten
// by functions/share/[[path]].ts) carries the app policy from public/_headers; the author
// and shared folder pages, which the Function builds itself, carry their own tighter one.
// The upstream fixture answers the Function through HOMEBASE_UPSTREAM_OVERRIDE
// (playwright.config.ts) on share-og.spec.ts's port; the edge project runs one worker, so
// the two never listen at once.

const APP = "default-src 'self'";
const AUTHOR_PAGE = "default-src 'none'";

const IDENTITY = 'csp.example.com';
const NOTE = '44444444-4444-4444-4444-000000000001';
const FOLDER = '55555555-5555-5555-5555-000000000001';

let upstream: Server;

test.beforeAll(async () => {
  upstream = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:8799');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const note = {
      fileId: 'cccccccc-0000-0000-0000-000000000001',
      fileMetadata: {
        created: Date.UTC(2026, 1, 1),
        updated: Date.UTC(2026, 1, 2),
        isEncrypted: false,
        payloads: [],
        appData: { uniqueId: NOTE, groupId: FOLDER, userDate: Date.UTC(2026, 1, 1), archivalStatus: 0, content: JSON.stringify({ title: 'CSP note' }) },
      },
    };
    if (url.pathname === '/pub/profile') return json(200, { name: 'Edge Author' });
    if (url.pathname === '/api/guest/v1/drive/query/specialized/cuid/header') {
      if (url.searchParams.get('clientUniqueId') !== FOLDER) return json(200, note);
      return json(200, {
        fileId: 'cccccccc-0000-0000-0000-000000000002',
        fileMetadata: {
          isEncrypted: false,
          updated: Date.UTC(2026, 1, 2),
          payloads: [],
          appData: { uniqueId: FOLDER, archivalStatus: 0, content: JSON.stringify({ name: 'CSP folder', isPublic: true }) },
        },
      });
    }
    if (url.pathname === '/api/guest/v1/drive/query/batch') {
      return json(200, { cursorState: '', includeMetadataHeader: true, searchResults: [note] });
    }
    json(404, {});
  });
  await new Promise<void>((resolve) => upstream.listen(8799, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => upstream?.close(resolve));
});

for (const path of ['/', '/some/deep/route', '/share/someone.example/abc']) {
  test(`${path} carries the app's Report-Only policy`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('id="root"');
    expect(res.headers()['content-security-policy-report-only']).toContain(APP);
    expect(res.headers()['content-security-policy']).toBeUndefined();
  });
}

test('a note share page rewritten with its meta keeps the policy', async ({ request }) => {
  test.skip(!!process.env.E2E_EDGE_BASE_URL, 'needs the local upstream fixture');
  const res = await request.get(`/share/${IDENTITY}/${NOTE}`);
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('property="og:title" content="CSP note"');
  expect(res.headers()['content-security-policy-report-only']).toContain(APP);
  expect(res.headers()['content-security-policy']).toBeUndefined();
});

for (const path of [`/share/${IDENTITY}`, `/share/${IDENTITY}/f/${FOLDER}`]) {
  test(`${path} carries the author page's Report-Only policy`, async ({ request }) => {
    test.skip(!!process.env.E2E_EDGE_BASE_URL, 'needs the local upstream fixture');
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('CSP note');
    expect(res.headers()['content-security-policy-report-only']).toContain(AUTHOR_PAGE);
    expect(res.headers()['content-security-policy']).toBeUndefined();
  });
}
