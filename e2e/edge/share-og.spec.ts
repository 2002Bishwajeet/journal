import { createServer, type Server } from 'node:http';
import { test, expect } from '../fixtures';

// functions/share/[[path]].ts puts the note's link-preview meta in the shell.
// `wrangler pages dev` points it at this fixture server through the
// HOMEBASE_UPSTREAM_OVERRIDE binding (playwright.config.ts), so these only run
// against the local edge server, never a deployed URL.
test.skip(!!process.env.E2E_EDGE_BASE_URL, 'needs the local upstream fixture');

const OK_NOTE = '11111111-1111-1111-1111-111111111111';
const FAILING_NOTE = '11111111-1111-1111-1111-222222222222';
const TWITTERBOT = { 'User-Agent': 'Twitterbot/1.0' };
const CHROME = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};

let upstream: Server;

test.beforeAll(async () => {
  upstream = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1:8799');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/pub/profile') return json(200, { name: 'Edge Author' });
    if (url.pathname === '/api/guest/v1/drive/query/specialized/cuid/header') {
      const id = url.searchParams.get('clientUniqueId');
      if (id === OK_NOTE) {
        return json(200, {
          fileId: 'aaaaaaaa-0000-0000-0000-000000000001',
          fileMetadata: {
            created: Date.UTC(2026, 0, 2),
            updated: Date.UTC(2026, 0, 3),
            isEncrypted: false,
            appData: {
              content: JSON.stringify({ title: 'Edge T', card: { description: 'Edge D', coverKey: 'jrnl_img0' } }),
            },
            payloads: [{ key: 'jrnl_img0' }],
          },
        });
      }
      if (id === FAILING_NOTE) return json(500, {});
    }
    json(404, {});
  });
  await new Promise<void>((resolve) => upstream.listen(8799, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => upstream?.close(resolve));
});

function expectNoteMeta(html: string) {
  expect(html).toContain('property="og:title" content="Edge T"');
  expect(html).toContain('property="og:description" content="Edge D"');
  // #220: a cover becomes the guest thumb URL on the author's identity.
  expect(html).toMatch(
    /property="og:image" content="https:\/\/edge\.example\.com\/api\/guest\/v1\/drive\/files\/thumb\?[^"]*payloadKey=jrnl_img0[^"]*"/,
  );
  expect(html).toMatch(/name="twitter:image" content="[^"]*\/api\/guest\/v1\/drive\/files\/thumb\?[^"]*payloadKey=jrnl_img0/);
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain('application/ld+json');
  expect(html).toContain('noindex');
}

test('a public note unfurls with its own meta', async ({ request }) => {
  const res = await request.get(`/share/edge.example.com/${OK_NOTE}`, { headers: TWITTERBOT });
  expect(res.status()).toBe(200);
  expectNoteMeta(await res.text());
  expect(res.headers()['cross-origin-embedder-policy']).toBe('require-corp');
});

test('an upstream failure serves the plain shell', async ({ request }) => {
  const res = await request.get(`/share/edge.example.com/${FAILING_NOTE}`, { headers: TWITTERBOT });
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('<title>Journal - Effortless Writing</title>');
  expect(html).not.toContain('application/ld+json');
});

test('an invalid identity serves the plain shell', async ({ request }) => {
  const res = await request.get(`/share/localhost/${OK_NOTE}`, { headers: TWITTERBOT });
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('<title>Journal - Effortless Writing</title>');
  expect(html).not.toContain('application/ld+json');
});

test('browsers get the same meta and the SPA root', async ({ request }) => {
  const res = await request.get(`/share/edge.example.com/${OK_NOTE}`, { headers: CHROME });
  const html = await res.text();
  expectNoteMeta(html);
  expect(html).toContain('id="root"');
});
