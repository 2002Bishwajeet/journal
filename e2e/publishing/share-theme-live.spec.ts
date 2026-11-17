import type { Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #1370: an open share page follows the OS light/dark switch without a reload, and the
// article's DOM (its image) stays the same node. Same canned public note as share-lightbox.spec.ts.

const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '5d1a7c42-8e3b-4f69-b2a0-6c9e4d1f7a35';
const FILE_ID = '2f6b9d84-1c5e-4a73-8d02-9b4e7a3c6f18';
const NOTE_TITLE = 'Follows the OS';
const PUBLISHED = Date.UTC(2026, 10, 17, 9, 0);

const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#8fa3ad"/></svg>';

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.insert(0, children);
  return el;
}

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([
    element('paragraph', [new Y.XmlText('A paragraph and a picture.')]),
    element('image', [], { src: `attachment://${FILE_ID}/jrnl_img0`, alt: 'Picture' }),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function mockPublicNote(page: Page): Promise<void> {
  const header = {
    fileId: FILE_ID,
    fileSystemType: 'Standard',
    fileMetadata: {
      isEncrypted: false,
      updated: PUBLISHED,
      payloads: [{ key: 'jrnl_txt' }],
      appData: { uniqueId: NOTE_ID, userDate: PUBLISHED, archivalStatus: 0, content: JSON.stringify({ title: NOTE_TITLE }) },
    },
  };
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const url = new URL(route.request().url());
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!url.pathname.endsWith('/payload')) {
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    }
    return url.searchParams.get('key') === 'jrnl_img0'
      ? route.fulfill({ contentType: 'image/svg+xml', headers: { ...headers, decryptedcontenttype: 'image/svg+xml' }, body: PICTURE })
      : route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() });
  });
}

test('share page: flipping the OS colour scheme changes the theme live, without a reload', async ({ anonPage: page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await mockPublicNote(page);
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  const picture = article.getByRole('img', { name: 'Picture' });
  await expect.poll(() => picture.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('html')).toHaveClass(/light/);

  // The same DOM node and no new navigation after the flips: nothing reloaded.
  await page.evaluate(() => {
    (window as unknown as { __kept: Element | null }).__kept = document.querySelector('article img');
    (window as unknown as { __marker: number }).__marker = 1;
  });

  await page.screenshot({ path: test.info().outputPath('share-theme-live-light-1280.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.locator('html')).not.toHaveClass(/light/);
  await page.screenshot({ path: test.info().outputPath('share-theme-live-dark-1280.png') });

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveClass(/light/);

  expect(await page.evaluate(() => (window as unknown as { __marker?: number }).__marker)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { __kept: Element | null }).__kept === document.querySelector('article img'))).toBe(true);
});

test('share page: a stored Dark choice wins over the OS scheme', async ({ anonPage: page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('journal-theme-preference', 'dark'));
  await mockPublicNote(page);
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('html')).toHaveClass(/dark/);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveClass(/dark/);
});
