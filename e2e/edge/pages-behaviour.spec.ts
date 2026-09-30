import { test, expect } from '../fixtures';

// Behaviour that only exists on Cloudflare Pages (public/_headers,
// public/_redirects), checked against `wrangler pages dev` or a deployed URL.

test('/ is cross-origin isolated', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  expect(res.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  expect(res.headers()['cross-origin-opener-policy']).toBe('same-origin');
});

for (const path of ['/share/someone.example/abc', '/some/deep/route']) {
  test(`${path} falls back to the SPA shell`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
    expect(await res.text()).toContain('id="root"');
  });
}

test('hashed assets are cached as immutable', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
  expect(asset, 'no /assets/*.js in the shell').toBeTruthy();

  const res = await request.get(asset!);
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toContain('immutable');
});

// A missing chunk served as the SPA shell (200, immutable) got cached by the
// zone for a year, so a chunk requested before its deploy stayed HTML after it.
test('a missing /assets/ file is an uncacheable 404, not the shell', async ({ request }) => {
  const res = await request.get(`/assets/does-not-exist-${Date.now()}.js`);
  expect(res.status()).toBe(404);
  expect(res.headers()['cache-control'] ?? '').not.toContain('immutable');
  expect(await res.text()).not.toContain('id="root"');
});

// Pages 308s /index.html -> /, and a redirected response served to a
// navigation is a hard network error, so the SW must precache '/'.
test('the service worker precaches / and not index.html', async ({ request }) => {
  const body = await (await request.get('/sw.js')).text();
  expect(body).toContain('"url":"/"');
  expect(body).not.toContain('"url":"index.html"');
});

test('a signed-out visit to / reaches /welcome', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/welcome$/);
});
