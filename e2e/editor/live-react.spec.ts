import { readFileSync } from 'node:fs';
import type { FrameLocator, Locator, Page, Request } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { activeEditor, createNote, pastePlainText } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #426: a `react` code block renders a React component on the app's own React, in the
// sandboxed frame an html block gets, with no network. Entry points: typed, pasted as a
// fence, and on the share page (an agent's write is in agentEditEngine.test.ts).

// The counter every entry point uses. One line to type, several to paste and publish.
const COUNTER = [
  'function App() {',
  '  const [count, setCount] = useState(0);',
  '  return (',
  '    <div>',
  '      <p>Count: {count}</p>',
  '      <button onClick={() => setCount(count + 1)}>Add one</button>',
  '    </div>',
  '  );',
  '}',
].join('\n');
const COUNTER_LINE = COUNTER.split('\n').map((line) => line.trim()).join(' ');
const SYNTAX_ERROR = 'function App() { return <div>; }';
const THROWS = "function App() { throw new Error('The counter broke'); }";

// Every isolation check of e2e/editor/live-html-sandbox.spec.ts, made by a component, plus a popup.
const PROBE = [
  'function App() {',
  '  const [lines, setLines] = useState([]);',
  "  const report = (name, result) => setLines((all) => [...all, name + ': ' + result]);",
  '  useEffect(() => {',
  "    const attempt = (name, read) => { try { report(name, 'readable ' + JSON.stringify(read())); } catch (e) { report(name, 'threw ' + e.name); } };",
  "    attempt('localStorage', () => localStorage.getItem('e2e-secret'));",
  "    attempt('parent.document', () => parent.document.title);",
  "    attempt('cookie', () => document.cookie);",
  "    fetch('https://example.com').then(() => report('fetch', 'resolved'), () => report('fetch', 'rejected'));",
  '    const img = new Image();',
  "    img.onload = () => report('img', 'loaded');",
  "    img.onerror = () => report('img', 'blocked');",
  "    img.src = 'https://example.com/x.png';",
  '  }, []);',
  '  return (',
  '    <div>',
  "      <button onClick={() => report('popup', window.open('https://example.com/') ? 'opened' : 'blocked')}>Open a popup</button>",
  "      <pre id=\"out\">{lines.join('\\n')}</pre>",
  '    </div>',
  '  );',
  '}',
].join('\n');

// Written out, not imported: the frame's CSP must be the html block's, unchanged (#409).
const CDN = 'https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com';
const CSP = `default-src 'none'; script-src 'unsafe-inline' ${CDN}; style-src 'unsafe-inline' ${CDN}; img-src data: blob:; font-src data: ${CDN}; media-src data: blob:; form-action 'none'; base-uri 'none'`;

// The runtime and the compiler, as the preview build (vite.config.ts) and the dev server name them.
const RUNTIME_URL = /react-block-runtime/;
const COMPILER_URL = /reactBlockCompiler/;

const INSTALLED_REACT = (JSON.parse(readFileSync('node_modules/react/package.json', 'utf8')) as { version: string }).version;

const reactBlocks = (page: Page) => activeEditor(page).locator('[data-live-block="react"]');
const reactFrame = (block: Locator): FrameLocator => block.frameLocator('iframe[title="React preview"]');

/** True for a request made by a frame inside the page, rather than by the page itself. */
function fromFrame(request: Request): boolean {
  try {
    return request.frame().parentFrame() !== null;
  } catch {
    // A service worker's own request has no frame.
    return false;
  }
}

/** Screenshots the page with `block` in view, once a frame in it has painted. */
async function shoot(page: Page, block: Locator, name: string): Promise<void> {
  await block.scrollIntoViewIfNeeded();
  const frame = block.locator('iframe');
  if ((await frame.count()) > 0) {
    await frame.contentFrame().locator('body').evaluate(() => new Promise<void>((painted) => requestAnimationFrame(() => requestAnimationFrame(() => painted()))));
  }
  await page.screenshot({ path: test.info().outputPath(name) });
}

test("react block: typed, the counter runs on the app's own React, and nothing leaves the app's origin", async ({ app }) => {
  const requests: Request[] = [];
  app.on('request', (request) => requests.push(request));

  await createNote(app, { title: `React ${Date.now()}`, body: '```react ' + COUNTER_LINE });
  // An empty block starts in Code, so the note was typed into the source.
  await app.getByRole('button', { name: 'Preview', exact: true }).click();
  const block = reactBlocks(app);
  const frame = reactFrame(block);
  await expect(frame.getByText('Count: 0')).toBeVisible();
  await frame.getByRole('button', { name: 'Add one' }).click();
  await expect(frame.getByText('Count: 1')).toBeVisible();

  // The React in the frame is the app's own copy of the installed version.
  expect(await frame.locator('body').evaluate(() => (window as unknown as { React: { version: string } }).React.version)).toBe(INSTALLED_REACT);

  // The html block's sandbox and CSP, unchanged.
  const iframe = block.locator('iframe');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  const srcdoc = (await iframe.getAttribute('srcdoc'))!;
  expect(srcdoc.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)?.[1]).toBe(CSP);
  expect(srcdoc).not.toContain('unsafe-eval');

  // The fixture's network fence aborts every request off the app's origin (and fails the test
  // on one that is not a *.homebase.test identity). The frame made none at all.
  const origin = new URL(app.url()).origin;
  expect(requests.filter(fromFrame).map((request) => request.url())).toEqual([]);
  const offOrigin = requests
    .map((request) => new URL(request.url()))
    .filter((url) => url.protocol.startsWith('http') && url.origin !== origin && !url.hostname.endsWith('.homebase.test'));
  expect(offOrigin).toEqual([]);
  expect(requests.some((request) => RUNTIME_URL.test(request.url()))).toBe(true);
});

test('react block: pasted as a fence into an empty line, it opens in Preview and counts', async ({ app }) => {
  await createNote(app, { title: `React paste ${Date.now()}`, body: 'Intro' });
  await app.keyboard.press('Enter');
  await pastePlainText(app, '```react\n' + COUNTER + '\n```');

  // Nobody clicked Preview: the pasted block opens in it.
  const block = reactBlocks(app);
  await expect(block.getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const frame = reactFrame(block);
  await expect(frame.getByText('Count: 0')).toBeVisible();
  await frame.getByRole('button', { name: 'Add one' }).click();
  await expect(frame.getByText('Count: 1')).toBeVisible();
  // The block holds the source as pasted; none of it was left behind as text.
  expect(await block.locator('pre').textContent()).toBe(COUNTER);
  await expect(activeEditor(app)).not.toContainText('```');
});

test('react block: the frame cannot reach storage, the parent document, cookies or the network, or open a popup', async ({ app }) => {
  const popups: string[] = [];
  app.context().on('page', (page) => popups.push(page.url()));
  await createNote(app, { title: `React probe ${Date.now()}`, body: 'Intro' });
  // Something on the app's origin for the frame to fail to read.
  await assertTestOrigin(app);
  await app.evaluate(() => {
    document.cookie = 'e2e-secret=cookie-value';
    localStorage.setItem('e2e-secret', 'storage-value');
  });
  await app.keyboard.press('Enter');
  await pastePlainText(app, '```react\n' + PROBE + '\n```');

  const frame = reactFrame(reactBlocks(app));
  const out = frame.locator('#out');
  await frame.getByRole('button', { name: 'Open a popup' }).click();
  // Refused by the frame's CSP before a request exists: one that reached the network layer
  // would fail this test on teardown, through the fixture's network fence.
  await expect(out).toContainText('fetch: rejected');
  await expect(out).toContainText('img: blocked');
  await expect(out).toContainText('localStorage: threw SecurityError');
  await expect(out).toContainText('parent.document: threw SecurityError');
  await expect(out).toContainText('cookie: threw SecurityError');
  // No allow-popups in the sandbox: window.open gives nothing, even on a click.
  await expect(out).toContainText('popup: blocked');
  await expect(out).not.toContainText('readable');
  expect(popups).toEqual([]);

  // The app itself still has both, so the checks above were not vacuous.
  expect(await app.evaluate(() => document.cookie)).toContain('e2e-secret=cookie-value');
  expect(await app.evaluate(() => localStorage.getItem('e2e-secret'))).toBe('storage-value');
});

test('react block: a note without one loads neither the runtime nor the compiler, and a jsx block stays plain code', async ({ browser }) => {
  await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json' }, async (page) => {
    // Listening from before the first request: the boot is covered too.
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    await page.goto('/');
    await assertTestOrigin(page);
    await waitForAppReady(page);

    await createNote(page, { title: `Jsx ${Date.now()}`, body: '```jsx ' + COUNTER_LINE });
    await expect(activeEditor(page).locator('pre code')).toContainText('useState(0)');
    await expect(activeEditor(page).locator('[data-live-block]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
    expect(requested.some((url) => /\.js(\?|$)/.test(url))).toBe(true);
    expect(requested.filter((url) => RUNTIME_URL.test(url) || COMPILER_URL.test(url))).toEqual([]);

    // Enter three times leaves the code block; then a react block, which loads both.
    for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
    await page.keyboard.type('```react ' + COUNTER_LINE);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(reactFrame(reactBlocks(page)).getByText('Count: 0')).toBeVisible();
    expect(requested.some((url) => RUNTIME_URL.test(url))).toBe(true);
    expect(requested.some((url) => COMPILER_URL.test(url))).toBe(true);
  });
});

test('react block: after one render, it still renders offline after a reload', async ({ browser }) => {
  // The dev server builds no service worker; this needs the preview build's real /sw.js.
  test.skip(process.env.E2E_SERVER === 'dev', 'needs the preview build');
  // The hermetic project blocks service workers (playwright.config.ts). This test needs one to
  // serve the app offline, so its own context allows it; sw.ts only fetches the app's origin.
  await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json', serviceWorkers: 'allow' }, async (page) => {
    await page.goto('/');
    await assertTestOrigin(page);
    await waitForAppReady(page);
    // Once it controls the page, the service worker has precached the app.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    await createNote(page, { title: `React offline ${Date.now()}`, body: '```react ' + COUNTER_LINE });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(reactFrame(reactBlocks(page)).getByText('Count: 0')).toBeVisible();
    // The first render cached the runtime and the compiler (the react-block route in sw.ts).
    await expect
      .poll(() => page.evaluate(async () => ((await caches.has('react-block')) ? (await (await caches.open('react-block')).keys()).length : 0)))
      .toBe(2);

    await page.context().setOffline(true);
    try {
      await page.reload();
      await waitForAppReady(page);
      const frame = reactFrame(reactBlocks(page));
      await expect(frame.getByText('Count: 0')).toBeVisible();
      await frame.getByRole('button', { name: 'Add one' }).click();
      await expect(frame.getByText('Count: 1')).toBeVisible();
    } finally {
      await page.context().setOffline(false);
    }
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`react block in the editor: the counter, a syntax error and a render error, ${theme} theme`, async ({ app }) => {
    // The theme preference defaults to "system", which follows prefers-color-scheme.
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize({ width: 1280, height: 900 });
    await createNote(app, { title: `React states ${theme} ${Date.now()}`, body: '```react ' + COUNTER_LINE });
    for (const source of [SYNTAX_ERROR, THROWS]) {
      // Enter three times leaves the code block; then the next one.
      for (let i = 0; i < 3; i++) await app.keyboard.press('Enter');
      await app.keyboard.type('```react ' + source);
    }
    // Each typed block starts in Code.
    for (let i = 0; i < 3; i++) await app.getByRole('button', { name: 'Preview', exact: true }).nth(i).click();
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));
    const [counter, syntaxError, renderError] = [0, 1, 2].map((i) => reactBlocks(app).nth(i));

    await expect(reactFrame(counter).getByText('Count: 0')).toBeVisible();
    await reactFrame(counter).getByRole('button', { name: 'Add one' }).click();
    await expect(reactFrame(counter).getByText('Count: 1')).toBeVisible();

    // A compile error is text in place of the frame: its line and message.
    const alert = syntaxError.locator('[data-live-block-preview="react"] [role="alert"]');
    await expect(alert).toContainText('Couldn’t compile this component.');
    await expect(alert).toContainText('Line 1: Unterminated JSX contents');
    await expect(syntaxError.locator('iframe')).toHaveCount(0);

    // A render error is the component's own message, inside the frame.
    await expect(reactFrame(renderError).getByRole('alert')).toContainText('Error: The counter broke');

    await shoot(app, counter, `react-counter-editor-${theme}-desktop.png`);
    await shoot(app, syntaxError, `react-syntax-error-editor-${theme}-desktop.png`);
    await shoot(app, renderError, `react-render-error-editor-${theme}-desktop.png`);
  });
}

// The share page reads a public note from its author's identity: the GETs of one read,
// answered with canned values on a *.homebase.test identity, as in
// e2e/publishing/share-wide-blocks.spec.ts.
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '3f6c2a91-7d4e-4b58-9a0c-e2b1d5f87c46';
const FILE_ID = '8a2d4f16-5c3b-4e97-b1a0-6d9e7c2f3b58';
const NOTE_TITLE = 'A React block on the share page';

function noteContent(): Buffer {
  const doc = new Y.Doc();
  const block = (name: string, text: string, attributes: Record<string, string> = {}) => {
    const el = new Y.XmlElement(name);
    for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
    el.insert(0, [new Y.XmlText(text)]);
    return el;
  };
  doc.getXmlFragment('prosemirror').push([
    block('paragraph', 'A counter, then a block that does not compile and one that throws.'),
    block('codeBlock', COUNTER, { language: 'react' }),
    block('codeBlock', SYNTAX_ERROR, { language: 'react' }),
    block('codeBlock', THROWS, { language: 'react' }),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function openSharedNote(page: Page): Promise<Locator> {
  const published = Date.UTC(2026, 8, 30, 9, 0);
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
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  return article;
}

for (const theme of ['light', 'dark'] as const) {
  test(`react block on the share page: the counter counts, and both errors show, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize({ width: 1280, height: 900 });
    const article = await openSharedNote(anonPage);
    await expect(anonPage.locator('html')).toHaveClass(new RegExp(theme));
    const [counter, syntaxError, renderError] = [0, 1, 2].map((i) => article.locator('[data-live-block="react"]').nth(i));

    // The frames are lazy: each loads once it is near the viewport.
    await counter.scrollIntoViewIfNeeded();
    await expect(reactFrame(counter).getByText('Count: 0')).toBeVisible();
    await reactFrame(counter).getByRole('button', { name: 'Add one' }).click();
    await expect(reactFrame(counter).getByText('Count: 1')).toBeVisible();
    expect(await reactFrame(counter).locator('body').evaluate(() => (window as unknown as { React: { version: string } }).React.version)).toBe(INSTALLED_REACT);

    await expect(syntaxError.locator('[role="alert"]')).toContainText('Line 1: Unterminated JSX contents');
    await renderError.scrollIntoViewIfNeeded();
    await expect(reactFrame(renderError).getByRole('alert')).toContainText('Error: The counter broke');

    await shoot(anonPage, counter, `react-counter-share-${theme}-desktop.png`);
    await shoot(anonPage, syntaxError, `react-syntax-error-share-${theme}-desktop.png`);
    await shoot(anonPage, renderError, `react-render-error-share-${theme}-desktop.png`);
  });
}
