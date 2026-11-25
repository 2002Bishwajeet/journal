import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, withFencedPage } from '../fixtures';
import { hostedImages } from '../../mcp/hosted/images';
import { sqliteKv } from '../../mcp/hosted/kv';
import { nodeListener } from '../../mcp/hosted/node';

// #1506: the page a person opens from a hosted MCP upload URL when their agent can't POST the image itself.
// The real upload handler serves it on a loopback port, so nothing leaves this machine.

const PHOTO = path.resolve(import.meta.dirname, '../../src/__tests__/fixtures/images/cover-plain.webp');
const GRANT = 'grant-e2e';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

test('a person uploads a photo from the upload page, and the grant can place it once', async ({ browser }) => {
  const kv = sqliteKv(path.join(mkdtempSync(path.join(tmpdir(), 'journal-upload-page-')), 'grants.sqlite'));
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const images = hostedImages(kv, origin);
  server.on('request', nodeListener((request) => images.serve(request), origin, [], images.isLive));

  const shots = async (page: Page, what: string, viewport: string) => {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: test.info().outputPath(`${what}-${theme}-${viewport}.png`), fullPage: true });
    }
  };

  try {
    await withFencedPage(
      browser,
      { viewport: PHONE },
      async (page) => {
        const upload = await images.create(GRANT, 'cat.webp');
        await page.goto(upload.upload_url);
        await expect(page.getByRole('heading', { name: 'Add an image to Journal' })).toBeVisible();
        await expect(page.getByText('cat.webp')).toBeVisible();
        // Nothing wider than the phone's screen.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
        await shots(page, 'upload-page', 'phone');
        await page.setViewportSize(DESKTOP);
        await shots(page, 'upload-page', 'desktop');
        await page.setViewportSize(PHONE);

        await page.getByLabel(/Choose or take a photo/).setInputFiles(PHOTO);
        await expect(page.getByRole('status')).toHaveText(/^Uploaded\./);
        await shots(page, 'upload-done', 'phone');

        const placed = await images.load(GRANT, upload.source);
        expect(placed.contentType).toBe('image/webp');
        await expect(images.load(GRANT, upload.source)).rejects.toThrow('Upload not found');

        // The link was used up.
        await page.reload();
        await expect(page.getByRole('heading', { name: 'The image was not uploaded' })).toBeVisible();
      },
      [origin],
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
