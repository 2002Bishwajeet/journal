import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';

// Behaviour that only exists on Cloudflare Pages (site/public/_headers,
// site/public/_redirects), checked against `wrangler pages dev` or a deployed URL.
// The landing site is the root and the app is under /app/ (#913).

test('/app/ is cross-origin isolated', async ({ request }) => {
  const res = await request.get('/app/');
  expect(res.status()).toBe(200);
  expect(res.headers()['cross-origin-embedder-policy']).toBe('require-corp');
  expect(res.headers()['cross-origin-opener-policy']).toBe('same-origin');
});

test('/ is the landing page, without cross-origin isolation', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('Your notes stay home');
  expect(res.headers()['cross-origin-embedder-policy']).toBeUndefined();
});

// An app route is served app/404.html, the app's shell, with status 404 (site/public/_redirects).
for (const [path, status] of [['/share/someone.example/abc', 200], ['/app/some/deep/route', 404]] as const) {
  test(`${path} falls back to the app's shell`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(status);
    expect(res.headers()['content-type']).toContain('text/html');
    expect(await res.text()).toContain('id="root"');
  });
}

test('hashed assets are cached as immutable', async ({ request }) => {
  const html = await (await request.get('/app/')).text();
  const asset = html.match(/\/app\/assets\/[^"']+\.js/)?.[0];
  expect(asset, 'no /app/assets/*.js in the shell').toBeTruthy();

  const res = await request.get(asset!);
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toContain('immutable');
});

// A missing chunk served as the SPA shell (200, immutable) got cached by the
// zone for a year, so a chunk requested before its deploy stayed HTML after it.
test('a missing /app/assets/ file is an uncacheable 404, not the shell', async ({ request }) => {
  const res = await request.get(`/app/assets/does-not-exist-${Date.now()}.js`);
  expect(res.status()).toBe(404);
  expect(res.headers()['cache-control'] ?? '').not.toContain('immutable');
  expect(await res.text()).not.toContain('id="root"');
});

// Pages 308s /app/index.html -> /app/, and a redirected response served to a
// navigation is a hard network error, so the SW must precache '/app/'.
test('the service worker precaches /app/ and not index.html', async ({ request }) => {
  const body = await (await request.get('/app/sw.js')).text();
  expect(body).toContain('"url":"/app/"');
  expect(body).not.toContain('"url":"index.html"');
});

// The service worker of an app installed before #913 is on scope / and updates from /sw.js.
test('/sw.js removes the old root service worker', async ({ request }) => {
  const res = await request.get('/sw.js');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('javascript');
  expect(await res.text()).toContain('self.registration.unregister()');
});

for (const [from, to] of [
  ['/welcome', '/app/welcome'],
  ['/auth/finalize?identity=a.example', '/app/auth/finalize?identity=a.example'],
  ['/shared/n1?from=a.example', '/app/shared/n1?from=a.example'],
  ['/06cf9262-4eae-4276-b0d1-8ca3cf5be6f4/n1', '/app/06cf9262-4eae-4276-b0d1-8ca3cf5be6f4/n1'],
]) {
  test(`an old app link, ${from}, is a permanent redirect to /app/`, async ({ request }) => {
    const res = await request.get(from, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    const location = new URL(res.headers()['location'], 'http://x');
    expect(location.pathname + location.search).toBe(to);
  });
}

// The landing page's head script sends a visitor on before paint, so the app itself is
// stubbed here: only where the visitor lands is checked.
async function stubApp(page: Page): Promise<void> {
  await page.route('**/app/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>App</title>' }));
}
const signIn = (page: Page) => page.addInitScript(() => localStorage.setItem('APSS', 'AAECAwQFBgcICQoLDA0ODw=='));

test('a signed-out visitor at / sees the landing page', async ({ page }) => {
  await stubApp(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Your notes stay home' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
});

test('a signed-in visitor at / goes straight to /app/', async ({ page }) => {
  await stubApp(page);
  await signIn(page);
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page).toHaveTitle('App');
});

test('/?landing shows the landing page to a signed-in visitor', async ({ page }) => {
  await stubApp(page);
  await signIn(page);
  await page.goto('/?landing');
  await expect(page.getByRole('heading', { level: 1, name: 'Your notes stay home' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
});

test('the installed app at / opens /app/', async ({ page }) => {
  await stubApp(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('/?action=new', { waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/app\/\?action=new$/);
});

test('an old link to a user folder and note opens it under /app/', async ({ page }) => {
  await stubApp(page);
  await page.goto('/3f1c2b7a-0000-4000-8000-000000000001/n1?tag=x', { waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/app\/3f1c2b7a-0000-4000-8000-000000000001\/n1\?tag=x$/);
});
