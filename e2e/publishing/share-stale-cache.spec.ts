import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #543: a returning reader must see the edited note, not bytes their browser
// cached. The fake guest serves payloads keyed on the `lastModified` query
// param (like the real backend, whose responses are cached by URL): version 1
// has a body and a cover, version 2 a new body and no cover. The page must ask
// for version 2's URL after the header's `updated` moves.

const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '7b1d4e92-3a58-4c06-8f2d-9e5a1c7b3d60';
const FILE_ID = '2c9f6a15-8d3e-4b71-a0c4-5e7b2d9f1a38';
const V1 = Date.UTC(2026, 9, 1, 9, 0);
const V2 = Date.UTC(2026, 9, 2, 9, 0);

const COVER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1260"><rect width="100%" height="100%" fill="#ecc878"/></svg>';

function noteContent(text: string, withCover: boolean): Buffer {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment('prosemirror').push([paragraph]);
  if (withCover) doc.getMap('journalMeta').set('cover', { src: `attachment://${FILE_ID}/jrnl_img0`, positionY: 50 });
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

test('a share page reloaded after an edit shows the new body and no removed cover', async ({ anonPage: page }) => {
  let updated = V1;
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const url = new URL(route.request().url());
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
      // What the real backend sends: the browser may keep this URL's bytes for a year.
      'cache-control': 'public, max-age=31536000, immutable',
    };
    if (!url.pathname.endsWith('/payload')) {
      return route.fulfill({
        contentType: 'application/json',
        headers: { ...headers, 'cache-control': 'no-store' },
        body: JSON.stringify({
          fileId: FILE_ID,
          fileSystemType: 'Standard',
          fileMetadata: {
            isEncrypted: false,
            updated,
            payloads: [{ key: 'jrnl_txt' }],
            appData: { uniqueId: NOTE_ID, userDate: V1, archivalStatus: 0, content: JSON.stringify({ title: 'Stale cache note' }) },
          },
        }),
      });
    }
    if (url.searchParams.get('key') === 'jrnl_img0') {
      return route.fulfill({ contentType: 'image/svg+xml', headers: { ...headers, decryptedcontenttype: 'image/svg+xml' }, body: COVER_SVG });
    }
    const isV2 = url.searchParams.get('lastModified') === String(V2);
    return route.fulfill({
      contentType: 'application/octet-stream',
      headers,
      body: isV2 ? noteContent('Version two body.', false) : noteContent('Version one body.', true),
    });
  });

  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  await expect(page.getByText('Version one body.')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('main img').first()).toBeVisible();

  updated = V2;
  await page.reload();
  await expect(page.getByText('Version two body.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Version one body.')).toHaveCount(0);
  await expect(page.locator('main img')).toHaveCount(0);
});
