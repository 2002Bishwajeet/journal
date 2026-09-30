import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, activeTitleInput, createNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #411: a share page says whose content it is, and a signed-in reader can save
// a copy of the note into their own Journal, from the button or by opening the
// route directly. The share fixture is the canned guest response of #393: there
// is no fake drive (#196), just the GETs of one read, answered on a
// *.homebase.test identity that the network fence would otherwise abort.

const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '9d2b6e41-7a3c-4c58-b1f0-3e8a5d7c2b16';
const FILE_ID = '5a7c3e90-1b4d-4d62-9f83-6c0e2a8b4d17';
const NOTE_TITLE = 'Field notes on shared blocks';
const COPY_TITLE = `${NOTE_TITLE} (copy)`;
const PUBLISHED = Date.UTC(2026, 8, 30, 9, 0);

const INTRO = 'A note with every kind of block a reader might want to keep.';
const CALLOUT_TEXT = 'Callouts keep their variant.';
const TOGGLE_SUMMARY = 'More detail';
const TOGGLE_TEXT = 'Toggles keep their body.';
const MERMAID = ['graph LR', '  Draft[Write a draft] --> Review{Ready to share?}', '  Review -->|Yes| Publish[Publish the note]'].join('\n');
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120" fill="none" stroke="black" stroke-width="4"><rect x="10" y="10" width="100" height="100" rx="12"/><circle cx="180" cy="60" r="48"/></svg>';
// The kind of page a user pastes: several lines, a style and a script.
const HTML = [
  '<!doctype html>',
  '<html>',
  '<head>',
  '  <style>',
  '    body { font-family: system-ui; margin: 24px; }',
  '    #out { font-weight: 600; }',
  '  </style>',
  '</head>',
  '<body>',
  '  <h2>Counter</h2>',
  '  <p id="out">waiting</p>',
  '  <script>',
  "    document.getElementById('out').textContent = 'script ran';",
  '  </script>',
  '</body>',
  '</html>',
].join('\n');

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.insert(0, children);
  return el;
}

const paragraph = (text: string) => element('paragraph', [new Y.XmlText(text)]);
const codeBlock = (language: string, code: string) => element('codeBlock', [new Y.XmlText(code)], { language });
const taskItem = (text: string, checked: boolean) => element('taskItem', [paragraph(text)], { checked: String(checked) });

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([
    paragraph(INTRO),
    codeBlock('mermaid', MERMAID),
    codeBlock('svg', SVG),
    codeBlock('html', HTML),
    element('callout', [paragraph(CALLOUT_TEXT)], { variant: 'tip' }),
    element('toggle', [paragraph(TOGGLE_TEXT)], { summary: TOGGLE_SUMMARY }),
    element('table', [
      element('tableRow', [element('tableHeader', [paragraph('Plan')]), element('tableHeader', [paragraph('Sync')])]),
      element('tableRow', [element('tableCell', [paragraph('Free')]), element('tableCell', [paragraph('Your Homebase')])]),
    ]),
    element('taskList', [taskItem('Read the note', true), taskItem('Keep a copy', false)]),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

/** Answers the author's guest reads; returns every request that reached the author's identity. */
async function mockPublicNote(page: Page, { shared }: { shared: boolean } = { shared: true }): Promise<string[]> {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === AUTHOR) requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
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
  // A page route takes precedence over the fence's context route.
  await page.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!shared) return route.fulfill({ status: 404, headers, body: '' });
    return new URL(route.request().url()).pathname.endsWith('/payload')
      ? route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() })
      : route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
  });
  return requests;
}

const liveBlock = (scope: Locator, kind: string) => scope.locator(`[data-live-block="${kind}"]`);
const saveRoute = `/save-shared?identity=${AUTHOR}&file=${NOTE_ID}`;

/** Only reads reached the author's identity (the note as a guest, the byline's public profile). */
const expectOnlyGuestReads = (requests: string[]) => {
  expect(requests).toContainEqual(expect.stringMatching(/^GET \/api\/guest\//));
  for (const request of requests) expect(request).toMatch(/^GET \/(api\/guest|pub)\//);
};

/** The saved copy is open in the editor: text, live blocks and real callout / toggle nodes. */
async function expectSavedCopy(page: Page): Promise<void> {
  await expect(activeTitleInput(page)).toHaveValue(COPY_TITLE, { timeout: 30_000 });
  const editor = activeEditor(page);
  await expect(editor).toContainText(`Copied from ${new URL(page.url()).origin}/share/${AUTHOR}/${NOTE_ID}`);
  await expect(editor).toContainText(INTRO);

  // Live blocks preview: the diagram draws, the svg shows, and the html block's script runs in its frame.
  await expect(liveBlock(editor, 'mermaid').locator('svg[id^="mermaid-"]')).toBeVisible({ timeout: 30_000 });
  await expect(liveBlock(editor, 'svg').locator('img')).toBeVisible();
  const frame = liveBlock(editor, 'html').locator('iframe');
  await frame.scrollIntoViewIfNeeded();
  await expect(frame.contentFrame().getByText('script ran')).toBeVisible();

  // A callout and a toggle are blocks, not the markdown they were written as.
  await expect(editor.locator('[data-type="callout"][data-variant="tip"]')).toContainText(CALLOUT_TEXT);
  await expect(editor.locator('[data-type="toggle"]')).toContainText(TOGGLE_TEXT);
  await expect(page.getByLabel('Toggle title')).toHaveValue(TOGGLE_SUMMARY);
  await expect(editor).not.toContainText('[!tip]');
  await expect(editor).not.toContainText('<details>');

  await expect(editor.getByRole('cell', { name: 'Your Homebase' })).toBeVisible();
  await expect(editor.getByRole('checkbox', { name: 'Task item checkbox for Read the note' })).toBeChecked();
  await expect(editor.getByRole('checkbox', { name: 'Task item checkbox for Keep a copy' })).not.toBeChecked();
}

// Rows of the note list: a row shows the note's preview, which opens with the "Copied from" line (an open tab shows only the title).
const savedCopies = (page: Page) => page.getByRole('button').filter({ hasText: 'Copied from' });
const baselineRows = (page: Page) => page.getByRole('button').filter({ hasText: 'Already here.' });

test('share page: says whose content it is, with the author identity', async ({ anonPage }) => {
  await mockPublicNote(anonPage);
  await anonPage.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(anonPage);
  await expect(anonPage.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  await expect(
    anonPage.getByText(`Published by ${AUTHOR}. Content is the author's own and is not reviewed by Journal.`),
  ).toBeVisible();
  // The button links to the in-app route on this origin.
  await expect(anonPage.getByRole('link', { name: 'Save a copy' })).toHaveAttribute('href', saveRoute);
});

test('signed in, "Save a copy" opens a new copy; saving twice makes two notes', async ({ app }) => {
  const requests = await mockPublicNote(app);
  await createNote(app, { title: 'Baseline note', body: 'Already here.' });

  await app.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(app);
  await app.getByRole('link', { name: 'Save a copy' }).click();
  await expectSavedCopy(app);
  await expect(app.getByText(`Saved "${COPY_TITLE}"`)).toBeVisible();
  const first = app.url();

  // Again: a second, separate note.
  await app.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await app.getByRole('link', { name: 'Save a copy' }).click();
  await expect(app.getByText(`Saved "${COPY_TITLE}"`)).toBeVisible();
  await expect(activeTitleInput(app)).toHaveValue(COPY_TITLE);
  expect(app.url()).not.toBe(first);
  await expect(savedCopies(app)).toHaveCount(2);
  await expect(baselineRows(app)).toHaveCount(1);

  // The original is only ever read, as a guest.
  expectOnlyGuestReads(requests);
});

test('signed in, opening the route directly saves the same copy as the button', async ({ app }) => {
  const requests = await mockPublicNote(app);
  await app.goto(saveRoute);
  await assertTestOrigin(app);
  await waitForAppReady(app);
  await expectSavedCopy(app);
  await expect(app.getByText(`Saved "${COPY_TITLE}"`)).toBeVisible();

  // Reloading the copy's own URL saves nothing more.
  await app.reload();
  await waitForAppReady(app);
  await expect(activeTitleInput(app)).toHaveValue(COPY_TITLE);
  await expect(savedCopies(app)).toHaveCount(1);
  expectOnlyGuestReads(requests);
});

const BAD_LINKS: [string, string][] = [
  ['no identity or file', '/save-shared'],
  ['a malformed identity', `/save-shared?identity=not%20an%20identity&file=${NOTE_ID}`],
  ['a malformed file', `/save-shared?identity=${AUTHOR}&file=nope`],
];

for (const [name, link] of BAD_LINKS) {
  test(`bad link (${name}): shows the error state and creates no note`, async ({ app }) => {
    await mockPublicNote(app);
    await createNote(app, { title: 'Baseline note', body: 'Already here.' });

    await app.goto(link);
    await assertTestOrigin(app);
    await waitForAppReady(app);
    await expect(app.getByRole('alert')).toContainText("Couldn't save a copy");
    await app.getByRole('link', { name: 'Go to Journal' }).click();
    await expect(baselineRows(app)).toHaveCount(1);
    await expect(savedCopies(app)).toHaveCount(0);
  });
}

test('an unshared note shows the error state and creates no note', async ({ app }) => {
  await mockPublicNote(app, { shared: false });
  await createNote(app, { title: 'Baseline note', body: 'Already here.' });

  await app.goto(saveRoute);
  await assertTestOrigin(app);
  await waitForAppReady(app);
  await expect(app.getByRole('alert')).toContainText("Couldn't save a copy", { timeout: 30_000 });
  await app.getByRole('link', { name: 'Go to Journal' }).click();
  await expect(baselineRows(app)).toHaveCount(1);
  await expect(savedCopies(app)).toHaveCount(0);
});

test('signed out, "Save a copy" goes to sign-in and keeps the route with its query', async ({ anonPage }) => {
  await mockPublicNote(anonPage);
  await anonPage.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(anonPage);
  await anonPage.getByRole('link', { name: 'Save a copy' }).click();
  await expect(anonPage).toHaveURL(/\/welcome\?/);
  expect(new URL(anonPage.url()).searchParams.get('returnUrl')).toBe(saveRoute);
});
