import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #103: PGlite boots while auth resolves, but only for a returning, logged-in
// app visit. A share-page reader or a logged-out visitor must never download
// the PGlite chunk, its .wasm or its .data before signing in.

// The heavy parts: engine, worker and extension chunks plus the wasm/data payload.
// (Two ~60 KB glue chunks, pglite-<hash>.js, are modulepreloaded by index.html
// for every visitor today; they download no database and are out of scope here.)
const PGLITE_ASSET = /\/pglite-(engine|worker|v4|tools)-|\.wasm$|\.data$/i;

/** Records every request path the page makes from now on. */
function trackRequests(page: Page): string[] {
  const paths: string[] = [];
  page.on('request', (request) => paths.push(new URL(request.url()).pathname));
  return paths;
}

test('a share page never requests PGlite assets', async ({ anonPage: page }) => {
  // A guest read that 404s is enough: the page mounts and settles on its error state.
  await page.route('https://e2e-author.homebase.test/api/guest/v1/drive/**', (route) =>
    route.fulfill({
      status: 404,
      headers: {
        'access-control-allow-origin': route.request().headers()['origin'] ?? '*',
        'access-control-allow-credentials': 'true',
      },
      body: '',
    }),
  );
  const requested = trackRequests(page);
  await page.goto('/share/e2e-author.homebase.test/0b8e4c27-5d1a-4f93-a6e2-7c3d9f1b5e40');
  await assertTestOrigin(page);
  await expect(page.getByRole('heading', { name: 'Note Not Found' })).toBeVisible({ timeout: 15_000 });
  expect(requested.filter((path) => PGLITE_ASSET.test(path))).toEqual([]);
});

test('a logged-out visitor never requests PGlite assets', async ({ anonPage: page }) => {
  const requested = trackRequests(page);
  await page.goto('/');
  await assertTestOrigin(page);
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(requested.filter((path) => PGLITE_ASSET.test(path))).toEqual([]);
});

test('a stored login boots the database early and lists notes as before', async ({ app }) => {
  const mark = (name: string) =>
    app.evaluate((n) => performance.getEntriesByName(`boot:${n}`)[0]?.startTime ?? null, name);
  const [react, dbStart, dbReady] = await Promise.all([mark('react'), mark('db-start'), mark('db-ready')]);
  expect(react).not.toBeNull();
  expect(dbStart).not.toBeNull();
  expect(dbReady).not.toBeNull();
  expect(dbStart!).toBeGreaterThanOrEqual(react!);
  expect(dbReady!).toBeGreaterThanOrEqual(dbStart!);
  await expect.poll(() => mark('first-note')).not.toBeNull();
});
