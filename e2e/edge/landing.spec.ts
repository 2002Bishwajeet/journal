import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #913: functions/index.ts serves / as the app with the journal_session cookie (the app's
// routing hint, src/lib/sessionHint.ts) and as the landing page without it. Every other path
// is unchanged.

const HTML = { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
const COOKIE = { Cookie: 'journal_session=1' };
const LANDING_TITLE = 'Journal: your notes stay home';
// __journalE2E is not set on the edge origin (src/lib/e2e/testHooks.ts), so wait for the app's sidebar.
const appShown = (page: Page) => expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible({ timeout: 20_000 });
const hasCookie = (cookies: { name: string }[]) => cookies.some((c) => c.name === 'journal_session');

// The hermetic signed-in identity (e2e/fixtures/hermetic-auth.json), on the edge origin.
function signedInState(origin: string) {
  const state = JSON.parse(readFileSync('e2e/fixtures/hermetic-auth.json', 'utf8'));
  const { localStorage } = state.origins.find((o: { origin: string }) => o.origin === 'http://127.0.0.1:4173');
  return { cookies: [], origins: [{ origin, localStorage }] };
}

test('/ is the landing page for a page load without the cookie, private and varying by cookie', async ({ request }) => {
  const res = await request.get('/', { headers: HTML });
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain(`<title>${LANDING_TITLE}</title>`);
  expect(html).not.toContain('id="root"');
  expect(res.headers()['cache-control']).toBe('private, no-cache');
  expect(res.headers()['vary']).toContain('Cookie');
});

test('/ is the app with the cookie, private and varying by cookie', async ({ request }) => {
  const res = await request.get('/', { headers: { ...HTML, ...COOKIE } });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('id="root"');
  expect(res.headers()['cache-control']).toBe('private, no-cache');
  expect(res.headers()['vary']).toContain('Cookie');
  expect(res.headers()['cross-origin-embedder-policy']).toBe('require-corp');
});

// The service worker precaches '/' as the app's shell, signed in or not.
test('/ is the app for a fetch that does not ask for HTML', async ({ request }) => {
  const res = await request.get('/', { headers: { Accept: '*/*' } });
  expect(await res.text()).toContain('id="root"');
});

test('/index.html redirects to /, which the edge decides', async ({ request }) => {
  const res = await request.get('/index.html', { maxRedirects: 0 });
  expect([301, 308]).toContain(res.status());
  expect(new URL(res.headers()['location'], 'http://x').pathname).toBe('/');
});

test('the landing site\'s other pages are under /landing/', async ({ request }) => {
  for (const path of ['/landing/agents', '/landing/pricing']) {
    const res = await request.get(path, { headers: HTML });
    expect(res.status(), path).toBe(200);
    expect(await res.text(), path).not.toContain('id="root"');
  }
});

for (const path of ['/welcome', '/06cf9262-4eae-4276-b0d1-8ca3cf5be6f4/abc', '/share/someone.example/abc']) {
  test(`${path} is still the app's shell without the cookie`, async ({ request }) => {
    const res = await request.get(path, { headers: HTML });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('id="root"');
  });
}

test('a signed-out browser sees the landing page at /, and Open Journal signs in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(LANDING_TITLE);
  await expect(page.getByRole('heading', { name: 'Your notes stay home', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');

  await page.getByRole('main').getByRole('link', { name: 'Open Journal' }).first().click();
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('a browser signed in before the cookie existed lands in the app, with no landing flash', async ({ browser, baseURL }) => {
  await withFencedPage(browser, { storageState: signedInState(baseURL!) }, async (page) => {
    // Record whether the landing page was ever visible before the reload.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.title.startsWith('Journal: your notes stay home')) {
          sessionStorage.setItem('landing-visibility', getComputedStyle(document.documentElement).visibility);
        }
      });
    });
    const pageLoads: string[] = [];
    page.on('request', (r) => { if (r.isNavigationRequest()) pageLoads.push(new URL(r.url()).pathname); });
    await page.goto('/');
    await assertTestOrigin(page);
    await appShown(page);
    expect(new URL(page.url()).pathname).toBe('/');
    expect(await page.evaluate(() => document.getElementById('root') !== null)).toBe(true);
    // The landing page, then / again as the app.
    expect(pageLoads.slice(0, 2)).toEqual(['/', '/']);
    expect([null, 'hidden']).toContain(await page.evaluate(() => sessionStorage.getItem('landing-visibility')));
    expect(hasCookie(await page.context().cookies())).toBe(true);
  });
});

test('with the cookie, / is the app; after logout, / is the landing page', async ({ browser, baseURL }) => {
  await withFencedPage(browser, { storageState: signedInState(baseURL!) }, async (page) => {
    await page.context().addCookies([{ name: 'journal_session', value: '1', url: baseURL! }]);
    await page.goto('/');
    await assertTestOrigin(page);
    await appShown(page);
    expect(await page.evaluate(() => document.getElementById('root') !== null)).toBe(true);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveTitle(LANDING_TITLE);
    expect(new URL(page.url()).pathname).toBe('/');
    expect(hasCookie(await page.context().cookies())).toBe(false);
  });
});
