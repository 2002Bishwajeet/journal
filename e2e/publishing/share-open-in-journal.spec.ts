import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #1341: the share page offers "Open in Journal" in a desktop browser. It is a link to the
// matching journal:// URL (no auto-redirect). Screenshots: light and dark, 1280px.

const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '3f6a2d18-9c4b-4e71-b5a0-8d2e7c1f4b93';
const FILE_ID = '6d1b8f42-0e7a-4c35-9b26-a4f3e8c7d519';
const PUBLISHED = Date.UTC(2026, 8, 30, 9, 0);

function noteContent(): Buffer {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText('A short shared note.')]);
  doc.getXmlFragment('prosemirror').push([paragraph]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

for (const theme of ['light', 'dark'] as const) {
  test(`share page offers Open in Journal, ${theme} theme, 1280px`, async ({ anonPage: page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1280, height: 800 });
    const header = {
      fileId: FILE_ID,
      fileSystemType: 'Standard',
      fileMetadata: {
        isEncrypted: false,
        updated: PUBLISHED,
        payloads: [{ key: 'jrnl_txt' }],
        appData: { uniqueId: NOTE_ID, userDate: PUBLISHED, archivalStatus: 0, content: JSON.stringify({ title: 'Hand this note to the app' }) },
      },
    };
    await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
      const headers = {
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
        'access-control-expose-headers': 'decryptedcontenttype',
      };
      return new URL(route.request().url()).pathname.endsWith('/payload')
        ? route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() })
        : route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    });
    await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
    await assertTestOrigin(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Hand this note to the app' })).toBeVisible({ timeout: 15_000 });

    const open = page.getByRole('banner').getByRole('link', { name: 'Open in Journal' });
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute('href', `journal://share/${AUTHOR}/${NOTE_ID}`);
    await page.screenshot({ path: test.info().outputPath(`share-open-in-journal-${theme}-1280.png`) });
  });
}
