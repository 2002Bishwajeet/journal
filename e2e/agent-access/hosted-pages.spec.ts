import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect, withFencedPage } from '../fixtures';
import { hostedImages, uploadsDb } from '../../mcp/hosted/images';
import { nodeListener } from '../../mcp/hosted/node';
import { FONT_PATHS, consentPage, html, messagePage } from '../../mcp/hosted/pages';

// #1516: the hosted MCP's pages in the Journal design, each state at 390 and 1280 px, light and dark.
// pages.ts renders them on a loopback port, with the real upload handler and the fonts fonts.ts serves
// (read here from the same files: a spec can't import a woff2), so nothing leaves this machine.

const fontFile = (pkg: string, file: string) => readFileSync(path.resolve(import.meta.dirname, '../../node_modules/@fontsource-variable', pkg, 'files', file));
const FONTS = new Map([
  [FONT_PATHS.inter, fontFile('inter', 'inter-latin-wght-normal.woff2')],
  [FONT_PATHS.playfair, fontFile('playfair-display', 'playfair-display-latin-wght-normal.woff2')],
]);
const PHOTO = path.resolve(import.meta.dirname, '../../src/__tests__/fixtures/images/cover-plain.webp');
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
const CLAUDE = {
  clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
  clientName: 'Claude',
  clientDomain: 'claude.ai',
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  redirectHost: 'claude.ai',
  redirectIsLoopback: false,
  scope: ['journal'],
};
const LOCAL = { ...CLAUDE, clientId: 'local', clientName: 'Local agent', clientDomain: undefined, redirectUri: 'http://127.0.0.1:33418/callback', redirectHost: '127.0.0.1', redirectIsLoopback: true };

/** Each viewport in both themes, after checking the page fits a phone and loaded the brand's fonts. */
async function shots(page: Page, what: string) {
  expect(await page.evaluate(async () => {
    await document.fonts.ready;
    return [document.fonts.check('17px "Inter Variable"'), document.fonts.check('34px "Playfair Display Variable"')];
  })).toEqual([true, true]);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: test.info().outputPath(`${what}-${theme}-${viewport.width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize(VIEWPORTS[0]);
}

test('the hosted MCP pages: consent, consent with a problem, upload idle, error, uploading and done, messages', async ({ browser }) => {
  const uploads = uploadsDb(path.join(mkdtempSync(path.join(tmpdir(), 'journal-hosted-pages-')), 'uploads.sqlite'));
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const images = hostedImages(uploads, origin);
  const pages: Record<string, () => string> = {
    '/consent': () => consentPage(CLAUDE, 'handle', '/consent'),
    '/consent-problem': () => consentPage(LOCAL, 'handle', '/consent', 'That is not a Homebase identity: frodo.example. Check the address and try again.'),
    '/uploaded': () => messagePage('Image uploaded', 'Go back to your chat and tell your agent the image is there.'),
  };
  server.on(
    'request',
    nodeListener(
      async (request) => {
        const { pathname } = new URL(request.url);
        const font = FONTS.get(pathname);
        if (font) return new Response(new Uint8Array(font), { headers: { 'Content-Type': 'font/woff2' } });
        if (pages[pathname]) return html(pages[pathname](), 200);
        return images.serve(request);
      },
      origin,
      [],
      images.isLive,
    ),
  );

  try {
    await withFencedPage(
      browser,
      { viewport: VIEWPORTS[0] },
      async (page) => {
        await page.goto(`${origin}/consent`);
        await expect(page.getByRole('heading', { name: 'Connect Claude to Journal?' })).toBeVisible();
        await expect(page.getByRole('img', { name: 'Journal' })).toBeVisible();
        await expect(page.getByLabel('Your Homebase identity')).toBeFocused();
        for (const name of ['Continue', 'Cancel']) {
          expect((await page.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await shots(page, 'consent');

        await page.goto(`${origin}/consent-problem`);
        await expect(page.getByText('This app runs on your own computer.')).toBeVisible();
        await expect(page.getByLabel('Your Homebase identity')).toHaveAccessibleDescription(/That is not a Homebase identity: frodo\.example/);
        await shots(page, 'consent-problem');

        const upload = await images.create('user-e2e', 'grant-e2e', 'cat.webp');
        await page.goto(upload.upload_url);
        await expect(page.getByRole('heading', { name: 'Add an image to Journal' })).toBeVisible();
        await shots(page, 'upload-idle');

        const file = page.getByLabel(/Choose or take a photo/);
        await file.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
        await expect(page.getByRole('status')).toHaveText(/^That image could not be read\./);
        await shots(page, 'upload-error');

        // Hold the upload, to see the page while it is on its way.
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        await page.route(upload.upload_url, async (route) => {
          if (route.request().method() === 'POST') await held;
          await route.fallback();
        });
        await file.setInputFiles(PHOTO);
        await expect(page.getByRole('status')).toHaveText('Uploading…');
        await expect(file).toBeDisabled();
        await shots(page, 'upload-progress');
        release();
        await expect(page.getByRole('status')).toHaveText(/^Uploaded\./);
        await shots(page, 'upload-done');
        expect((await images.load('grant-e2e', upload.source)).contentType).toBe('image/webp');

        // The link was used up: the expired-link message.
        await page.reload();
        await expect(page.getByRole('heading', { name: 'The image was not uploaded' })).toBeVisible();
        await shots(page, 'message-expired');

        await page.goto(`${origin}/uploaded`);
        await expect(page.getByRole('heading', { name: 'Image uploaded' })).toBeVisible();
        await shots(page, 'message-uploaded');
      },
      [origin],
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
