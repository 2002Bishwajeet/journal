import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #616: a note link on a share page opens the linked note's share page. Note A links to
// the public note B and to the private note C (the guest read answers 403).

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;

const AUTHOR = 'e2e-author.homebase.test';
const C_NOTE_ID = '3b7d1f85-2e6a-4c93-a048-d5f9b1e7c602';
const PUBLISHED = Date.UTC(2026, 9, 12, 9, 0);

function linkNode(label: string, noteId: string): Y.XmlElement {
  const el = new Y.XmlElement('noteLink');
  el.setAttribute('noteId', noteId);
  el.setAttribute('label', label);
  return el;
}

function content(children: (Y.XmlElement | Y.XmlText)[]): Buffer {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, children);
  doc.getXmlFragment('prosemirror').push([paragraph]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

const B = { noteId: '9c2e4b61-3f7a-4d08-8b15-6a0e3d7c1f94', fileId: '1d8b5e73-6a2c-4f09-9e41-b7c3a0d6f285', title: 'Note B the public one', body: content([new Y.XmlText('Body of B')]) };
const A = {
  noteId: '5a1c7e42-8d3b-4f60-b2a9-1e6d0c4f8a37',
  fileId: '7e3f9a26-1b5c-4d84-a0e7-3c9b2d6f1e58',
  title: 'Note A links out',
  body: content([new Y.XmlText('Go to '), linkNode('Note B', B.noteId), new Y.XmlText(' or '), linkNode('Note C', C_NOTE_ID)]),
};
const NOTES = [A, B];

test.beforeEach(async ({ anonPage: page }) => {
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const url = route.request().url();
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    const note = NOTES.find((n) => url.includes(n.noteId) || url.includes(n.fileId));
    if (!note) return route.fulfill({ status: 403, headers, contentType: 'application/json', body: '{}' });
    if (new URL(url).pathname.endsWith('/payload')) {
      return route.fulfill({ contentType: 'application/octet-stream', headers, body: note.body });
    }
    return route.fulfill({
      contentType: 'application/json',
      headers,
      body: JSON.stringify({
        fileId: note.fileId,
        fileSystemType: 'Standard',
        fileMetadata: {
          isEncrypted: false,
          updated: PUBLISHED,
          payloads: [{ key: 'jrnl_txt' }],
          appData: { uniqueId: note.noteId, userDate: PUBLISHED, archivalStatus: 0, content: JSON.stringify({ title: note.title }) },
        },
      }),
    });
  });
});

for (const theme of THEMES) {
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    test(`share page: a note link opens the linked share page, ${theme} ${vp}`, async ({ anonPage }) => {
      await anonPage.emulateMedia({ colorScheme: theme });
      await anonPage.setViewportSize(size);
      await anonPage.goto(`/share/${AUTHOR}/${A.noteId}`);
      await assertTestOrigin(anonPage);
      const article = anonPage.getByRole('article');
      await expect(article.getByRole('heading', { level: 1, name: A.title })).toBeVisible({ timeout: 15_000 });
      await expect(article.getByRole('link', { name: 'Note B' })).toHaveAttribute('href', `/share/${AUTHOR}/${B.noteId}`);
      await anonPage.screenshot({ path: test.info().outputPath(`share-note-links-source-${theme}-${vp}.png`) });

      // Public: same tab, B's share page
      await article.getByRole('link', { name: 'Note B' }).click();
      await expect(anonPage).toHaveURL(new RegExp(`/share/${AUTHOR}/${B.noteId}$`));
      await expect(anonPage.getByRole('article').getByRole('heading', { level: 1, name: B.title })).toBeVisible({ timeout: 15_000 });
      await anonPage.screenshot({ path: test.info().outputPath(`share-note-links-public-${theme}-${vp}.png`) });

      // Private: C's share URL shows the not-public state
      await anonPage.goBack();
      await expect(anonPage.getByRole('article').getByRole('heading', { level: 1, name: A.title })).toBeVisible({ timeout: 15_000 });
      await anonPage.getByRole('article').getByRole('link', { name: 'Note C' }).click();
      await expect(anonPage).toHaveURL(new RegExp(`/share/${AUTHOR}/${C_NOTE_ID}$`));
      await expect(anonPage.getByRole('heading', { name: 'Note Not Found' })).toBeVisible({ timeout: 15_000 });
      await expect(anonPage.getByText('This note is not shared publicly.')).toBeVisible();
      await anonPage.screenshot({ path: test.info().outputPath(`share-note-links-private-${theme}-${vp}.png`) });
    });
  }
}
