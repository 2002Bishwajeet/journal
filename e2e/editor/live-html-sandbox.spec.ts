import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
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

/** Creates a note with the probe as an `html` block, previews it, and returns its frame. */
async function previewProbe(app: Page) {
  await createNote(app, { title: `Html ${Date.now()}`, body: '```html ' + PROBE });
  // Something on the app's origin for the frame to fail to read.
  await assertTestOrigin(app);
  await app.evaluate(() => {
    document.cookie = 'e2e-secret=cookie-value';
    localStorage.setItem('e2e-secret', 'storage-value');
  });
  await app.getByRole('button', { name: 'Preview', exact: true }).click();
  return activeEditor(app).frameLocator('iframe[title="HTML preview"]');
}

test("html block: its inline script runs in the frame under the app's COEP headers", async ({ app }) => {
  // True only when the page was served with COOP same-origin + COEP require-corp.
  expect(await app.evaluate(() => window.crossOriginIsolated)).toBe(true);

  const frame = await previewProbe(app);
  await expect(frame.locator('#ran')).toHaveText('script ran');

  const iframe = activeEditor(app).locator('iframe[title="HTML preview"]');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');

  // 400px tall, and the native resize handle is reachable over the frame.
  const resizable = iframe.locator('..');
  await expect(resizable).toHaveCSS('height', '400px');
  const box = (await resizable.boundingBox())!;
  await app.mouse.move(box.x + box.width - 4, box.y + box.height - 4);
  await app.mouse.down();
  await app.mouse.move(box.x + box.width - 4, box.y + box.height + 96, { steps: 5 });
  await app.mouse.up();
  await expect(resizable).toHaveCSS('height', '500px');
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
