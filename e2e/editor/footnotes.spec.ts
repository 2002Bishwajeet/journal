import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #518: footnotes inserted from the slash menu, numbered by reference order,
// with jumps between a reference and its note; synced between tabs; and
// rendered on the share page with working back links. Screenshots: light,
// dark, and 390px.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;

const refs = (editor: Locator) => editor.locator('sup[data-type="footnote-reference"]');
const notes = (editor: Locator) => editor.locator('li[data-type="footnote"]');

/** Puts the caret `offset` characters into the editor's first paragraph. */
async function caretInFirstParagraph(editor: Locator, offset: number) {
  await editor.evaluate((el, at) => {
    (el as HTMLElement).focus();
    const text = el.querySelector('p')?.firstChild;
    if (!text) throw new Error('no text in the first paragraph');
    const range = document.createRange();
    range.setStart(text, at);
    range.collapse(true);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, offset);
}

/** `/footnote` at the caret, then the note's text (the cursor lands in the new note). */
async function insertFootnote(page: Page, note: string) {
  await page.keyboard.type(' /footnote');
  await expect(page.getByRole('button', { name: /Footnote/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type(note);
}

for (const theme of THEMES) {
  test(`editor footnotes: insert, renumber, jump and delete, ${theme} theme`, async ({ app }) => {
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize(VIEWPORTS.desktop);
    await createNote(app, { title: `Footnotes ${theme} ${Date.now()}`, body: 'Alpha beta gamma' });
    const editor = activeEditor(app);

    await insertFootnote(app, 'Note on gamma');
    await expect(refs(editor)).toHaveCount(1);
    await expect(refs(editor).first()).toHaveAttribute('data-number', '1');
    await expect(notes(editor).first()).toContainText('Note on gamma');

    // A footnote inserted before it becomes 1, and the first one becomes 2.
    await caretInFirstParagraph(editor, 'Alpha'.length);
    await insertFootnote(app, 'Note on alpha');
    await expect(refs(editor)).toHaveCount(2);
    await expect(refs(editor).nth(0)).toHaveAttribute('data-number', '1');
    await expect(refs(editor).nth(1)).toHaveAttribute('data-number', '2');
    await expect(notes(editor).nth(0)).toContainText('Note on alpha');
    await expect(notes(editor).nth(1)).toContainText('Note on gamma');

    // Reference -> its note (the cursor lands at the end of its text) ...
    await refs(editor).nth(1).click();
    await app.keyboard.type('!');
    await expect(notes(editor).nth(1)).toContainText('Note on gamma!');
    // ... and the note's back link -> the reference.
    await notes(editor).nth(1).getByRole('button', { name: 'Back to reference' }).click();
    await expect(refs(editor).nth(1)).toHaveClass(/ProseMirror-selectednode/);

    await app.screenshot({ path: test.info().outputPath(`footnotes-editor-${theme}-1280.png`) });
    // The layout swaps at this width and the note remounts.
    await app.setViewportSize(VIEWPORTS.mobile);
    await expect(app.getByText('Loading document...')).toBeHidden();
    await expect(notes(activeEditor(app)).nth(1)).toBeInViewport();
    await app.screenshot({ path: test.info().outputPath(`footnotes-editor-${theme}-390.png`) });
    await app.setViewportSize(VIEWPORTS.desktop);
    await expect(notes(editor).nth(1)).toContainText('Note on gamma!');

    // Deleting reference 1 drops its note; gamma's becomes 1.
    await notes(editor).nth(0).getByRole('button', { name: 'Back to reference' }).click();
    await expect(refs(editor).nth(0)).toHaveClass(/ProseMirror-selectednode/);
    await app.keyboard.press('Backspace');
    await expect(refs(editor)).toHaveCount(1);
    await expect(refs(editor).first()).toHaveAttribute('data-number', '1');
    await expect(notes(editor)).toHaveCount(1);
    await expect(notes(editor).first()).toContainText('Note on gamma!');

    // Saved like any other content.
    await app.waitForTimeout(1000);
    await app.reload();
    await waitForAppReady(app);
    await expect(refs(activeEditor(app))).toHaveCount(1);
    await expect(notes(activeEditor(app)).first()).toContainText('Note on gamma!');
  });
}

test('footnotes sync between two tabs on the same note', async ({ app }) => {
  await createNote(app, { title: `Footnotes two tabs ${Date.now()}`, body: 'Shared text' });
  const pageB = await app.context().newPage();
  await pageB.goto(app.url());
  await assertTestOrigin(pageB);
  await waitForAppReady(pageB);
  const editorB = activeEditor(pageB);
  await expect(editorB).toContainText('Shared text');

  await insertFootnote(app, 'From tab A');
  await expect(refs(editorB)).toHaveCount(1, { timeout: 5000 });
  await expect(refs(editorB).first()).toHaveAttribute('data-number', '1');
  await expect(notes(editorB).first()).toContainText('From tab A', { timeout: 5000 });

  // B adds one before A's: both tabs renumber.
  await caretInFirstParagraph(editorB, 'Shared'.length);
  await insertFootnote(pageB, 'From tab B');
  const editorA = activeEditor(app);
  await expect(refs(editorA)).toHaveCount(2, { timeout: 5000 });
  await expect(notes(editorA).nth(0)).toContainText('From tab B', { timeout: 5000 });
  await expect(notes(editorA).nth(1)).toContainText('From tab A');
  await expect(refs(editorA).nth(1)).toHaveAttribute('data-number', '2');
  await pageB.close();
});

// Share page: same canned-GET approach as share-reader-interactions.spec.ts (#196: no fake drive).
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '3b8f2d61-7a4c-4e19-9c05-2d6e8a1f4b73';
const FILE_ID = '9a2c5e17-4d3b-4f86-b1a0-6c7e3d9f2b58';
const NOTE_TITLE = 'Footnotes on the share page';
const PUBLISHED = Date.UTC(2026, 9, 1, 9, 0);

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.insert(0, children);
  return el;
}

const text = (value: string) => new Y.XmlText(value);
const paragraph = (...children: (Y.XmlElement | Y.XmlText)[]) => element('paragraph', children);
const ref = (id: string) => element('footnoteReference', [], { id });
const footnote = (id: string, value: string) => element('footnote', [paragraph(text(value))], { id });

function noteContent(): Buffer {
  const doc = new Y.Doc();
  const filler = Array.from({ length: 40 }, (_, i) => paragraph(text(`Filler paragraph ${i + 1}, so the notes sit below the fold.`)));
  doc.getXmlFragment('prosemirror').push([
    paragraph(text('The trip starts in Lisbon'), ref('a'), text(' and ends in Porto'), ref('b'), text('.')),
    ...filler,
    element('footnotes', [footnote('a', 'Three nights by the river.'), footnote('b', 'By train, about three hours.')]),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function openSharedNote(page: Page): Promise<Locator> {
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
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!new URL(route.request().url()).pathname.endsWith('/payload')) {
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    }
    return route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() });
  });
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  return article;
}

for (const theme of THEMES) {
  test(`share page footnotes: references and back links jump, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize(VIEWPORTS.desktop);
    const article = await openSharedNote(anonPage);

    const links = article.locator('a[data-footnote-ref]');
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveText('1');
    await expect(links.nth(1)).toHaveText('2');
    const items = article.locator('section.footnotes li');
    await expect(items.nth(0)).toContainText('Three nights by the river.');
    await expect(items.nth(1)).toContainText('By train, about three hours.');
    await expect(items.nth(1)).not.toBeInViewport();

    await links.nth(1).click();
    await expect(items.nth(1)).toBeInViewport();
    await anonPage.screenshot({ path: test.info().outputPath(`footnotes-share-${theme}-1280.png`) });

    await items.nth(1).locator('a[data-footnote-backref]').click();
    await expect(links.nth(1)).toBeInViewport();
    await expect(items.nth(1)).not.toBeInViewport();

    await anonPage.setViewportSize(VIEWPORTS.mobile);
    await links.nth(0).click();
    await expect(items.nth(0)).toBeInViewport();
    await anonPage.screenshot({ path: test.info().outputPath(`footnotes-share-${theme}-390.png`) });
  });
}
