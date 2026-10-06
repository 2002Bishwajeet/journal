import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, pastePlainText } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #410: an html block saves small state in the note with journal.storage, and gets it
// back after a reload of the app. On the share page a reader gets the owner's state,
// and their own changes last until they reload the page.

const COUNTER = [
  '<p id="out">loading</p>',
  '<button id="save">Save 3</button>',
  '<button id="bad">Save bad values</button>',
  '<pre id="errors"></pre>',
  '<script>',
  "const out = document.getElementById('out');",
  "journal.storage.get('count').then((count) => { out.textContent = 'count: ' + count; });",
  "document.getElementById('save').onclick = () => journal.storage.set('count', 3).then(() => { out.textContent = 'saved'; });",
  "const errors = document.getElementById('errors');",
  "const attempt = (name, value) => journal.storage.set(name, value).then(() => { errors.textContent += name + ': saved\\n'; }, (e) => { errors.textContent += name + ': ' + e.message + '\\n'; });",
  "document.getElementById('bad').onclick = () => attempt('big', 'x'.repeat(70000)).then(() => attempt('date', new Date()));",
  '</script>',
].join('\n');

const block = (app: Page) => activeEditor(app).locator('[data-live-block="html"]');
const frame = (app: Page) => block(app).frameLocator('iframe[title="HTML preview"]');

async function counterNote(app: Page): Promise<string> {
  const title = `Html storage ${Date.now()}`;
  await createNote(app, { title, body: 'Intro' });
  await app.keyboard.press('Enter');
  // Pasted without an id: it gets one on its first save.
  await pastePlainText(app, '```html\n' + COUNTER + '\n```');
  await expect(frame(app).locator('#out')).toHaveText('count: undefined');
  return title;
}

test('html block: journal.storage.set survives a reload of the app, and the block gets an id in its markdown', async ({ app }) => {
  const title = await counterNote(app);

  await frame(app).getByRole('button', { name: 'Save 3' }).click();
  await expect(frame(app).locator('#out')).toHaveText('saved');

  // The frame reloads when the theme changes; the state is kept by the app, not the frame.
  await app.evaluate(() => document.documentElement.classList.toggle('dark'));
  await expect(frame(app).locator('#out')).toHaveText('count: 3');

  // The save reaches the note at once, and PGlite a moment later. Nothing in the DOM shows
  // when, so wait as typeInEditor does.
  await app.waitForTimeout(1500);
  await app.reload();
  await waitForAppReady(app);
  await expect(frame(app).locator('#out')).toHaveText('count: 3');

  const [download] = await Promise.all([
    app.waitForEvent('download'),
    (async () => {
      await app.getByRole('button').filter({ hasText: title }).first().click({ button: 'right' });
      await app.getByRole('menuitem', { name: 'Export to Markdown' }).click();
    })(),
  ]);
  const markdown = await readFile(await download.path(), 'utf8');
  expect(markdown).toMatch(/^```html id=[a-z0-9]{8}\n<p id="out">loading<\/p>$/m);
});

test('html block: a value over 64 KB, or one that is not JSON, rejects and saves nothing', async ({ app }) => {
  await counterNote(app);

  await frame(app).getByRole('button', { name: 'Save bad values' }).click();
  const errors = frame(app).locator('#errors');
  await expect(errors).toContainText('big: journal.storage: a block can save at most 64 KB');
  await expect(errors).toContainText('date: journal.storage: a value must be JSON');
  await expect(errors).not.toContainText('saved');

  await app.waitForTimeout(1500);
  await app.reload();
  await waitForAppReady(app);
  await expect(frame(app).locator('#out')).toHaveText('count: undefined');
});

// The share page reads a public note from its author's identity: the GETs of one read,
// answered with canned values on a *.homebase.test identity, as in e2e/editor/live-react.spec.ts.
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '5b0e8c3a-21f4-4d6e-9a7b-c3d2e1f0a948';
const FILE_ID = '9c1f7e2d-4a3b-4c58-8d6e-0f1a2b3c4d5e';
const NOTE_TITLE = 'A counter with saved state';

const SHARED_COUNTER = [
  '<p id="out">loading</p>',
  '<button id="add">Add one</button>',
  '<script>',
  "const out = document.getElementById('out');",
  "const show = () => journal.storage.get('count').then((count) => { out.textContent = 'count: ' + count; });",
  "document.getElementById('add').onclick = () => journal.storage.get('count').then((count) => journal.storage.set('count', count + 1)).then(show);",
  'show();',
  '</script>',
].join('\n');

/** The note as the owner saved it: the block, with an id, and its state `{ count: 3 }`. */
function sharedNoteContent(): Buffer {
  const doc = new Y.Doc();
  const code = new Y.XmlElement('codeBlock');
  code.setAttribute('language', 'html id=k3f9');
  code.insert(0, [new Y.XmlText(SHARED_COUNTER)]);
  doc.getXmlFragment('prosemirror').push([code]);
  doc.getMap('liveBlockState').set('k3f9', JSON.stringify({ count: 3 }));
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

/** Opens the shared note, and returns the methods of every request made to the author's identity. */
async function openSharedNote(page: Page): Promise<string[]> {
  const methods: string[] = [];
  const published = Date.UTC(2026, 9, 6, 9, 0);
  const header = {
    fileId: FILE_ID,
    fileSystemType: 'Standard',
    fileMetadata: {
      isEncrypted: false,
      updated: published,
      payloads: [{ key: 'jrnl_txt' }],
      appData: { uniqueId: NOTE_ID, userDate: published, archivalStatus: 0, content: JSON.stringify({ title: NOTE_TITLE }) },
    },
  };
  // A page route takes precedence over the fence's context route.
  await page.route(`https://${AUTHOR}/**`, (route) => {
    methods.push(route.request().method());
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    return new URL(route.request().url()).pathname.endsWith('/payload')
      ? route.fulfill({ contentType: 'application/octet-stream', headers, body: sharedNoteContent() })
      : route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
  });
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  return methods;
}

test("share page: a reader sees the owner's saved state, and their own change lasts until they reload", async ({ anonPage }) => {
  await anonPage.emulateMedia({ colorScheme: 'light' });
  const methods = await openSharedNote(anonPage);
  const shared = anonPage.getByRole('article').locator('[data-live-block="html"]').frameLocator('iframe[title="HTML preview"]');
  const out = shared.locator('#out');

  await expect(out).toHaveText('count: 3');
  await shared.getByRole('button', { name: 'Add one' }).click();
  await expect(out).toHaveText('count: 4');

  // The frame reloads with the theme; the reader's copy is kept by the page.
  const before = await anonPage.locator('iframe[title="HTML preview"]').getAttribute('srcdoc');
  await anonPage.evaluate(() => document.documentElement.classList.toggle('dark'));
  await expect(anonPage.locator('iframe[title="HTML preview"]')).not.toHaveAttribute('srcdoc', before!);
  await expect(out).toHaveText('count: 4');

  await anonPage.reload();
  await expect(out).toHaveText('count: 3', { timeout: 15_000 });
  // Reads only: nothing was written to the owner's identity.
  expect(methods.length).toBeGreaterThan(0);
  expect(methods.filter((method) => method !== 'GET' && method !== 'OPTIONS')).toEqual([]);
});
