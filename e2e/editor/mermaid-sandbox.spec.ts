import type { Locator, Page, Request } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, mermaidFrame, pastePlainText } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #946: a mermaid block is drawn in the sandboxed frame of an html block, so what mermaid makes
// of a note's source never reaches the app's DOM. The frame's own origin and CSP are proved in
// e2e/editor/live-html-sandbox.spec.ts; here, that a diagram is in it and stays in it.

const EVIL = 'https://evil.example/mermaid.png';
const RED = 'rgb(255, 0, 0)';
// Aimed at the app: at its body, its note and everything else a selector can reach. `.nodeLabel`
// is in the diagram, so the rule shows that the directive got through to mermaid.
const THEME_CSS = `html, body, .ProseMirror, .share-article { background: ${RED} !important; color: ${RED} !important } .nodeLabel { background-image: url(${EVIL}) }`;
const HOSTILE = [`%%{init: {"themeCSS": ${JSON.stringify(THEME_CSS)}}}%%`, 'graph TD', '  Start[Start] --> Finish[Finish]'].join('\n');

/** What a diagram must not have changed in the app. */
const appLook = (page: Page) =>
  page.evaluate(() => {
    const { backgroundColor, color } = getComputedStyle(document.body);
    return { backgroundColor, color };
  });

/** The diagram of `block` is on the page in its frame, it took the hostile CSS, and none of it is in the app. */
async function expectContained(page: Page, block: Locator, before: { backgroundColor: string; color: string }): Promise<void> {
  await block.scrollIntoViewIfNeeded();
  const frame = mermaidFrame(block);
  await expect(frame.locator('svg[id^="mermaid-"]')).toBeVisible({ timeout: 30_000 });
  await expect(frame.locator('.nodeLabel').first()).toHaveCSS('background-image', /evil\.example/);

  await expect(block.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  // Light DOM only: the app's DOM holds a frame and no markup from mermaid.
  expect(await block.locator('svg:not([aria-hidden]), foreignObject, .nodeLabel').count()).toBe(0);
  expect(await page.locator('style').evaluateAll((styles) => styles.filter((style) => style.textContent?.includes('evil.example')).length)).toBe(0);
  expect(await page.locator('[id^="dmermaid"], [id^="mermaid-"]').count()).toBe(0);
  expect(await appLook(page)).toEqual(before);
}

test('editor: a themeCSS directive stays in the frame and cannot touch the app', async ({ reusedApp: app }) => {
  // Chromium reports a request the CSP stops too, as one that failed.
  const remote: Request[] = [];
  app.on('request', (request) => {
    if (request.url().startsWith(EVIL)) remote.push(request);
  });
  await createNote(app, { title: `Mermaid sandbox ${Date.now()}`, body: 'A paragraph.' });
  await app.keyboard.press('Enter');
  const before = await appLook(app);
  await pastePlainText(app, '```mermaid\n' + HOSTILE + '\n```');

  await expectContained(app, activeEditor(app).locator('[data-live-block="mermaid"]'), before);
  await expect(activeEditor(app).getByText('A paragraph.')).toHaveCSS('color', /^(?!rgb\(255, 0, 0\))/);
  // The frame's CSP has no network for an image, whatever a diagram's CSS asks for.
  await expect.poll(() => [...new Set(remote.map((request) => request.failure()?.errorText))]).toEqual(['csp']);
});

test('editor: a diagram link opens in a new tab, and the diagram stays put', async ({ reusedApp: app }) => {
  const url = 'https://example.com/from-a-diagram';
  // Answered here, so the new tab never meets the fixture's network fence.
  await app.context().route(url, (route) => route.fulfill({ contentType: 'text/html', body: 'linked page' }));
  await createNote(app, { title: `Mermaid link ${Date.now()}`, body: 'A paragraph.' });
  await app.keyboard.press('Enter');
  await pastePlainText(app, '```mermaid\n' + `graph TD\n  A[Open]\n  click A href "${url}"` + '\n```');

  const frame = mermaidFrame(activeEditor(app).locator('[data-live-block="mermaid"]'));
  await expect(frame.locator('svg[id^="mermaid-"]')).toBeVisible({ timeout: 30_000 });
  const [tab] = await Promise.all([app.context().waitForEvent('page'), frame.locator('svg a').click()]);
  await expect(tab).toHaveURL(url);
  await expect(frame.locator('svg[id^="mermaid-"]')).toBeVisible();
});

test('editor: a new theme redraws a diagram on the page it is on, which does not load again', async ({ app }) => {
  await createNote(app, { title: `Mermaid theme ${Date.now()}`, body: 'A paragraph.' });
  await app.keyboard.press('Enter');
  await pastePlainText(app, '```mermaid\ngraph TD\n  A[One] --> B[Two]\n```');

  const block = activeEditor(app).locator('[data-live-block="mermaid"]');
  const frame = mermaidFrame(block);
  await expect(frame.locator('svg#mermaid-1')).toBeVisible({ timeout: 30_000 });
  const page = frame.locator('html');
  await page.evaluate((html) => html.setAttribute('data-first-page', ''));
  const { height } = (await block.boundingBox())!;

  await app.emulateMedia({ colorScheme: 'dark' });
  await expect(frame.locator('svg#mermaid-2')).toBeVisible();
  await expect(page).toHaveAttribute('data-first-page', '');
  await expect(page).toHaveCSS('color-scheme', 'dark');
  expect((await block.boundingBox())!.height).toBe(height);
});

// The share page reads a public note from its author's identity. There is no fake drive (#196):
// the GETs of one read are answered with canned values, as in e2e/editor/mermaid-labels.spec.ts.
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '7a3e1c94-2b6d-4f08-8e57-c1d9a4b6f203';
const NOTE_TITLE = 'A diagram that aims at the app';
const PUBLISHED = Date.UTC(2026, 8, 30, 9, 0);

function noteContent(): Buffer {
  const doc = new Y.Doc();
  const block = new Y.XmlElement('codeBlock');
  block.setAttribute('language', 'mermaid');
  block.insert(0, [new Y.XmlText(HOSTILE)]);
  doc.getXmlFragment('prosemirror').push([block]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function mockPublicNote(page: Page): Promise<void> {
  const header = {
    fileId: '2f9c6b18-4e7a-4d35-b0a2-6e8d3c1f5a97',
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
    };
    return new URL(route.request().url()).pathname.endsWith('/payload')
      ? route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() })
      : route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
  });
}

test('share page: a themeCSS directive stays in the frame and cannot touch the page', async ({ anonPage }) => {
  await mockPublicNote(anonPage);
  await anonPage.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(anonPage);
  const article = anonPage.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  const before = await appLook(anonPage);

  await expectContained(anonPage, article.locator('[data-live-block="mermaid"]'), before);
});
