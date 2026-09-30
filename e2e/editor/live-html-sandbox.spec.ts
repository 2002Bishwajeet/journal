import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, pastePlainText } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #389: an `html` code block previews as a running page in a sandboxed frame
// that cannot reach the app, its storage or the network. Every isolation check
// is read from text the block's own script writes into its frame.

// One line, so typing it never leaves the code block.
const PROBE = [
  '<style>body { font-family: system-ui; }</style>',
  '<p id="ran"></p><pre id="out"></pre><img id="img" src="https://example.com/x.png">',
  '<script>',
  "const out = document.getElementById('out');",
  "const report = (name, result) => { out.textContent += name + ': ' + result + '\\n'; };",
  // A read that succeeds prints what it got, so a leak shows up in the failure message.
  "const attempt = (name, read) => { try { report(name, 'readable ' + JSON.stringify(read())); } catch (e) { report(name, 'threw ' + e.name); } };",
  "document.getElementById('ran').textContent = 'script ran';",
  "attempt('localStorage', () => localStorage.getItem('e2e-secret'));",
  "attempt('parent.document', () => parent.document.title);",
  "attempt('cookie', () => document.cookie);",
  "fetch('https://example.com').then(() => report('fetch', 'resolved'), () => report('fetch', 'rejected'));",
  "const img = document.getElementById('img');",
  "const imgDone = () => report('img', 'naturalWidth ' + img.naturalWidth);",
  'if (img.complete) imgDone(); else img.onload = img.onerror = imgDone;',
  '</script>',
].join('');

// #412: a page exactly 900px tall, with a button that makes it 400px taller. One line too.
const TALL = [
  '<style>body { margin: 0; font-family: system-ui; } #tall { box-sizing: border-box; height: 900px; padding: 24px; border: 4px dashed #999; }</style>',
  '<div id="tall"><h2>A page 900px tall</h2>',
  '<button onclick="tall.style.height = tall.offsetHeight + 400 + \'px\'">Grow by 400px</button></div>',
].join('');

// #409: a block may also load scripts, styles and fonts from three CDN hosts. The same
// source goes in every way a block can (typed, pasted bare, pasted as a fence; an agent's
// write is in agentEditEngine.test.ts): a script from an allowlisted host, an inline
// script that uses it, and a div it fills in.
const CDN_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/probe.js';
const OTHER_HOST_SCRIPT_URL = 'https://example.com/x.js';
const CDN_SOURCE = [
  '<div id="out">waiting for the CDN script</div>',
  `<script src="${CDN_SCRIPT_URL}"></script>`,
  '<script>',
  "document.getElementById('out').textContent = window.cdnProbe();",
  '</script>',
].join('\n');

// What the block's CSP still refuses: a script from any other host, and fetch even to an allowlisted one.
const CDN_LIMITS = [
  '<pre id="out"></pre>',
  `<script src="${CDN_SCRIPT_URL}"></script>`,
  `<script src="${OTHER_HOST_SCRIPT_URL}"></script>`,
  '<script>',
  "const report = (name, result) => { document.getElementById('out').textContent += name + ': ' + result + '\\n'; };",
  "report('allowlisted host', window.cdnProbe ? window.cdnProbe() : 'did not run');",
  "report('other host', window.otherHostRan ? 'ran' : 'did not run');",
  `fetch('${CDN_SCRIPT_URL}').then(() => report('fetch', 'resolved'), () => report('fetch', 'rejected'));`,
  '</script>',
].join('\n');

/**
 * Answers both script URLs with a fake, and returns the requests that got that far, as
 * `<resource type> <url>`. Routes added after the fixture's network fence run before it,
 * so only these two URLs are answered and every other request still meets the fence.
 * Each answer carries what the frame needs to use it (CORP for the COEP it inherits from
 * the app, CORS for fetch), so whatever fails to run or resolve was refused by the CSP.
 */
async function serveFakeScripts(app: Page): Promise<string[]> {
  const requests: string[] = [];
  const serve = (url: string, body: string) =>
    app.context().route(url, (route) => {
      requests.push(`${route.request().resourceType()} ${url}`);
      return route.fulfill({
        contentType: 'text/javascript',
        headers: { 'Cross-Origin-Resource-Policy': 'cross-origin', 'Access-Control-Allow-Origin': '*' },
        body,
      });
    });
  await serve(CDN_SCRIPT_URL, "window.cdnProbe = () => 'cdn script ran';");
  await serve(OTHER_HOST_SCRIPT_URL, 'window.otherHostRan = true;');
  return requests;
}

/** Creates a note with `source` as an `html` block, previews it, and returns its frame. */
async function previewProbe(app: Page, source = PROBE) {
  await createNote(app, { title: `Html ${Date.now()}`, body: '```html ' + source });
  // Something on the app's origin for the frame to fail to read.
  await assertTestOrigin(app);
  await app.evaluate(() => {
    document.cookie = 'e2e-secret=cookie-value';
    localStorage.setItem('e2e-secret', 'storage-value');
  });
  await app.getByRole('button', { name: 'Preview', exact: true }).click();
  return activeEditor(app).frameLocator('iframe[title="HTML preview"]');
}

/** The box an html block's frame fills: the element that carries the block's height. */
const resizableBox = (app: Page) => activeEditor(app).locator('[data-live-block-preview="html"]');

/** Drags the box's native resize handle (its bottom right corner) down by `dy` pixels. */
async function dragResizeHandle(app: Page, resizable: Locator, dy: number): Promise<void> {
  const box = (await resizable.boundingBox())!;
  await app.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
  await app.mouse.down();
  await app.mouse.move(box.x + box.width - 4, box.y + box.height - 4 + dy, { steps: 5 });
  await app.mouse.up();
}

/**
 * Starts listening on the app page for a height report of at least `min`, whoever
 * sends it. The returned function resolves once one was delivered: by then the
 * app's own handler has had the same message, so "nothing changed" is not a race.
 */
async function listenForHeightReport(app: Page, min: number): Promise<() => Promise<void>> {
  const listening = await app.evaluateHandle(
    (min) => ({
      delivered: new Promise<void>((resolve) => {
        window.addEventListener('message', function onMessage(event: MessageEvent<{ height?: number } | null>) {
          if ((event.data?.height ?? 0) < min) return;
          window.removeEventListener('message', onMessage);
          resolve();
        });
      }),
    }),
    min,
  );
  return () => listening.evaluate(({ delivered }) => delivered);
}

test("html block: its inline script runs in the frame under the app's COEP headers", async ({ app }) => {
  // True only when the page was served with COOP same-origin + COEP require-corp.
  expect(await app.evaluate(() => window.crossOriginIsolated)).toBe(true);

  const frame = await previewProbe(app);
  await expect(frame.locator('#ran')).toHaveText('script ran');

  const iframe = activeEditor(app).locator('iframe[title="HTML preview"]');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');

  // As tall as its content (#412) once the probe has written all its lines, and the
  // native resize handle is reachable over the frame.
  await expect(frame.locator('#out')).toContainText('fetch: rejected');
  await expect(frame.locator('#out')).toContainText('img: naturalWidth 0');
  const fitted = await frame.locator('html').evaluate((html) => Math.ceil(html.getBoundingClientRect().height));
  const resizable = iframe.locator('..');
  await expect(resizable).toHaveCSS('height', `${fitted}px`);
  await dragResizeHandle(app, resizable, 100);
  await expect(resizable).toHaveCSS('height', `${fitted + 100}px`);
});

test('html block: the frame cannot reach the network, storage, the parent document or cookies', async ({ app }) => {
  const frame = await previewProbe(app);
  const out = frame.locator('#out');

  // Blocked by the frame's CSP before a request exists: had one reached the
  // network layer, the fixture's network fence would fail this test on teardown.
  await expect(out).toContainText('fetch: rejected');
  await expect(out).toContainText('localStorage: threw SecurityError');
  await expect(out).toContainText('parent.document: threw SecurityError');
  // Chromium does not hand a sandboxed (opaque-origin) document an empty cookie
  // string: the read itself throws. Either way the app's cookie is out of reach.
  await expect(out).toContainText('cookie: threw SecurityError');
  await expect(out).not.toContainText('readable');

  // The app itself still has both, so the checks above were not vacuous.
  expect(await app.evaluate(() => document.cookie)).toContain('e2e-secret=cookie-value');
  expect(await app.evaluate(() => localStorage.getItem('e2e-secret'))).toBe('storage-value');
});

test('html block: an external image does not load', async ({ app }) => {
  const frame = await previewProbe(app);

  await expect(frame.locator('#out')).toContainText('img: naturalWidth 0');
  await expect(frame.locator('#img')).toHaveJSProperty('naturalWidth', 0);
});

test('html block: typed, a script from an allowlisted CDN host runs', async ({ app }) => {
  const requests = await serveFakeScripts(app);
  const frame = await previewProbe(app, CDN_SOURCE);

  await expect(frame.locator('#out')).toHaveText('cdn script ran');
  expect(new Set(requests)).toEqual(new Set([`script ${CDN_SCRIPT_URL}`]));
});

for (const [how, pasted] of [
  ['bare markup', CDN_SOURCE],
  ['a whole html fence', '```html\n' + CDN_SOURCE + '\n```'],
] as const) {
  test(`html block: pasted as ${how}, it opens in Preview and the CDN script runs`, async ({ app }) => {
    const requests = await serveFakeScripts(app);
    await createNote(app, { title: `Html paste ${Date.now()}`, body: 'Intro' });
    await app.keyboard.press('Enter');
    await pastePlainText(app, pasted);

    // Nobody clicked Preview: the pasted block opens in it.
    const block = activeEditor(app).locator('[data-live-block="html"]');
    await expect(block.getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(block.frameLocator('iframe[title="HTML preview"]').locator('#out')).toHaveText('cdn script ran');
    expect(new Set(requests)).toEqual(new Set([`script ${CDN_SCRIPT_URL}`]));
    // The block holds the source as pasted; none of it was left behind as literal text.
    expect(await block.locator('pre').textContent()).toBe(CDN_SOURCE);
    await expect(activeEditor(app).locator('p', { hasText: '<' })).toHaveCount(0);
    await expect(activeEditor(app)).not.toContainText('```');
  });
}

test('html block: a script from any other host does not run, and fetch to an allowlisted host rejects', async ({ app }) => {
  const requests = await serveFakeScripts(app);
  const frame = await previewProbe(app, CDN_LIMITS);
  const out = frame.locator('#out');

  await expect(out).toContainText('allowlisted host: cdn script ran');
  await expect(out).toContainText('other host: did not run');
  await expect(out).toContainText('fetch: rejected');
  // The CSP refused both before a request existed: the only one made was for the allowlisted script.
  expect(new Set(requests)).toEqual(new Set([`script ${CDN_SCRIPT_URL}`]));
});

test('html block: is as tall as its content and grows with it, until the user resizes it', async ({ app }) => {
  // Tall enough that the resize handle of a grown block is on screen.
  await app.setViewportSize({ width: 1280, height: 1800 });
  const frame = await previewProbe(app, TALL);
  const resizable = resizableBox(app);
  const grow = frame.getByRole('button', { name: 'Grow by 400px' });

  // Nobody resized it: the block took its content's height, and follows it.
  await expect(resizable).toHaveCSS('height', '900px');
  await expect(resizable.locator('iframe')).toHaveCSS('height', '900px');
  await grow.click();
  await expect(resizable).toHaveCSS('height', '1300px');

  // A height the user drags the block to wins over what the content reports next.
  await dragResizeHandle(app, resizable, -100);
  await expect(resizable).toHaveCSS('height', '1200px');
  const reported = await listenForHeightReport(app, 1700);
  await grow.click();
  await reported();
  await expect(resizable).toHaveCSS('height', '1200px');
});

test('html block: a height report posted by the app page itself changes no block', async ({ app }) => {
  await previewProbe(app, TALL);
  const resizable = resizableBox(app);
  await expect(resizable).toHaveCSS('height', '900px');

  // The right marker and a number, but not from the block's frame.
  const delivered = await listenForHeightReport(app, 5000);
  await app.evaluate(() => window.postMessage({ journalLiveBlock: 1, height: 5000 }, '*'));
  await delivered();
  await expect(resizable).toHaveCSS('height', '900px');
});

for (const colorScheme of ['light', 'dark'] as const) {
  // #424: no full screen. The block is as tall as its content and lives in the note.
  test(`html block: a 900px page gets a frame of its height and no Full screen control, ${colorScheme} theme`, async ({ app }) => {
    await app.emulateMedia({ colorScheme });
    // Tall enough to show the whole 900px block at its natural height.
    await app.setViewportSize({ width: 1280, height: 1200 });

    const frame = await previewProbe(app, TALL);
    const block = activeEditor(app).locator('[data-live-block="html"]');
    const resizable = resizableBox(app);
    await expect(frame.getByRole('heading', { name: 'A page 900px tall' })).toBeVisible();
    await expect(resizable).toHaveCSS('height', '900px');
    // Nothing scrolls inside the frame.
    expect(await frame.locator('html').evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
    await block.hover();
    await expect(block.getByRole('button', { name: /full ?screen/i })).toHaveCount(0);
    await expect(app.locator('html')).toHaveClass(new RegExp(colorScheme));
    await app.screenshot({ path: test.info().outputPath(`html-tall-${colorScheme}-desktop.png`) });
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`screenshot: running html block, ${colorScheme} theme`, async ({ app }) => {
    // The theme preference defaults to "system", which follows prefers-color-scheme.
    await app.emulateMedia({ colorScheme });
    await app.setViewportSize({ width: 1280, height: 960 });

    const frame = await previewProbe(app);
    await expect(frame.locator('#out')).toContainText('fetch: rejected');
    await expect(frame.locator('#out')).toContainText('img: naturalWidth 0');
    await expect(app.locator('html')).toHaveClass(new RegExp(colorScheme));

    await app.screenshot({ path: test.info().outputPath(`live-html-block-${colorScheme}-desktop.png`) });
  });
}
