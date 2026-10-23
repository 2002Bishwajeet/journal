import type { Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { activeEditor, createNote, pastePlainText, typeInEditor } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #671: every page carries a Content-Security-Policy-Report-Only header (public/_headers,
// mirrored by vite.config.ts), and the app's main flows break none of it. A violation of
// a Report-Only policy is not blocked, so a `securitypolicyviolation` listener in every
// document collects it. Live blocks' srcdoc frames inherit the policy and get the listener
// too; each step reads them while its frames are still mounted.

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

type Collector = { read: () => Promise<string[]> };

/** Starts collecting Report-Only violations in every page and frame of `page`'s context loaded from now on. */
async function collectViolations(page: Page): Promise<Collector> {
  await page.context().addInitScript(() => {
    const seen: string[] = [];
    window.__cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.disposition !== 'report') return;
      seen.push(`${event.effectiveDirective} blocked ${event.blockedURI || '(inline)'} in ${event.documentURI.slice(0, 80)}`);
    });
  });
  return {
    read: async () => {
      const inFrames = await Promise.all(
        page.frames().map((frame) => frame.evaluate(() => window.__cspViolations ?? []).catch(() => [])),
      );
      return [...new Set(inFrames.flat())];
    },
  };
}

async function expectNoViolations(collector: Collector): Promise<void> {
  const violations = await collector.read();
  expect(violations, `CSP Report-Only violations:\n${violations.join('\n')}`).toEqual([]);
}

test('the shell carries the Report-Only policy, also when the service worker serves it', async ({ browser }) => {
  test.skip(process.env.E2E_SERVER === 'dev', 'needs the preview build');
  await withFencedPage(browser, { storageState: 'e2e/fixtures/hermetic-auth.json', serviceWorkers: 'allow' }, async (page) => {
    const first = await page.goto('/');
    await assertTestOrigin(page);
    expect(first!.headers()['content-security-policy-report-only']).toContain("default-src 'self'");
    expect(first!.headers()['content-security-policy']).toBeUndefined();
    await waitForAppReady(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    const reloaded = await page.reload();
    expect(reloaded!.fromServiceWorker()).toBe(true);
    expect(reloaded!.headers()['content-security-policy-report-only']).toContain("default-src 'self'");
  });
});

test('signed out: booting to the welcome page violates nothing', async ({ anonPage }) => {
  const collector = await collectViolations(anonPage);
  await anonPage.goto('/');
  await assertTestOrigin(anonPage);
  await expect(anonPage).toHaveURL(/\/welcome$/);
  await expect(anonPage.getByRole('heading').first()).toBeVisible();
  await expectNoViolations(collector);
});

const CDN_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/probe.js';
const HTML_CDN_BLOCK = `<div id="out">waiting</div><script src="${CDN_SCRIPT_URL}"></script><script>document.getElementById('out').textContent = window.cdnProbe();</script>`;
const PAPA_TABLE = [
  "import Papa from 'papaparse';",
  '',
  "const csv = 'mood,days\\ncalm,12\\nbusy,9';",
  '',
  'export default function App() {',
  '  const { data } = Papa.parse(csv, { header: true, skipEmptyLines: true });',
  '  return <table id="papa-table"><tbody>{data.map((row) => <tr key={row.mood}><td>{row.mood}</td><td>{row.days}</td></tr>)}</tbody></table>;',
  '}',
].join('\n');
const LINK_URL = 'https://example.com/article';
const LINK_TITLE = 'An example article';
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('signed in: notes, live blocks and a link preview violate nothing', async ({ app }) => {
  test.slow(); // five notes in one test: ~34s on CI against the 30s default
  const collector = await collectViolations(app);
  await app.reload();
  await assertTestOrigin(app);
  await waitForAppReady(app);

  await test.step('a note, typed into', async () => {
    await createNote(app, { title: `CSP note ${Date.now()}`, body: 'Typing a few words' });
    await expect(activeEditor(app)).toContainText('Typing a few words');
    await expectNoViolations(collector);
  });

  await test.step('an html block that loads a CDN script', async () => {
    // Answered here, with the CORP the frame's inherited COEP requires (see live-html-sandbox.spec.ts).
    await app.context().route(CDN_SCRIPT_URL, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        headers: { 'Cross-Origin-Resource-Policy': 'cross-origin' },
        body: "window.cdnProbe = () => 'cdn script ran';",
      }),
    );
    await createNote(app, { title: `CSP html ${Date.now()}`, body: '```html ' + HTML_CDN_BLOCK });
    await app.getByRole('button', { name: 'Preview', exact: true }).click();
    const frame = activeEditor(app).frameLocator('iframe[title="HTML preview"]');
    await expect(frame.locator('#out')).toHaveText('cdn script ran');
    await expectNoViolations(collector);
  });

  await test.step('a react block that imports a library', async () => {
    await createNote(app, { title: `CSP react ${Date.now()}`, body: 'Intro' });
    await app.keyboard.press('Enter');
    await pastePlainText(app, '```react\n' + PAPA_TABLE + '\n```');
    const frame = activeEditor(app).locator('[data-live-block="react"]').frameLocator('iframe[title="React preview"]');
    await expect(frame.locator('#papa-table tr')).toHaveCount(2);
    await expectNoViolations(collector);
  });

  await test.step('a mermaid block and an svg block', async () => {
    await createNote(app, { title: `CSP diagrams ${Date.now()}`, body: '```mermaid graph TD; A-->B' });
    await app.keyboard.press('Enter');
    await app.keyboard.press('Enter');
    await app.keyboard.press('Enter');
    await typeInEditor(app, '```svg <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10"/></svg>');
    // Each block has its own Preview/Code pair: mermaid is first, svg second.
    await app.getByRole('button', { name: 'Preview', exact: true }).nth(0).click();
    await app.getByRole('button', { name: 'Preview', exact: true }).nth(1).click();
    await expect(activeEditor(app).locator('[data-live-block-preview] svg')).toBeVisible();
    await expect(activeEditor(app).locator('[data-live-block-preview] img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await expectNoViolations(collector);
  });

  await test.step('a link preview card', async () => {
    // The SDK's extract call, answered the way link-preview.spec.ts does.
    await app.route('**/api/apps/v1/utils/links/extract*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': new URL(app.url()).origin, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify({ title: LINK_TITLE, description: 'D', imageUrl: PIXEL, imageWidth: 1, imageHeight: 1, url: LINK_URL }),
      }),
    );
    await createNote(app, { title: `CSP link ${Date.now()}`, body: 'Intro line' });
    await app.keyboard.press('Enter');
    await pastePlainText(app, LINK_URL);
    const card = activeEditor(app).locator('[data-link-preview]');
    await expect(card).toContainText(LINK_TITLE);
    await expect(card.locator('img')).toBeVisible();
    await expectNoViolations(collector);
  });
});

// A public note with one image, answered the way share-image-layout.spec.ts does.
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '6c2d8e41-7f3a-4b95-a0c8-2e1f9d7b3a64';
const FILE_ID = '8a4b2c19-3d5e-4f60-9b71-5e2a8c0d1f37';
const NOTE_TITLE = 'A note with a picture';
const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#8fa3ad"/></svg>';

function noteContent(): Buffer {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  const image = new Y.XmlElement('image');
  image.setAttribute('src', `attachment://${FILE_ID}/jrnl_img0`);
  image.setAttribute('alt', 'Picture');
  paragraph.insert(0, [image]);
  doc.getXmlFragment('prosemirror').push([paragraph]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

test('a share page with an image violates nothing', async ({ anonPage }) => {
  const collector = await collectViolations(anonPage);
  const header = {
    fileId: FILE_ID,
    fileSystemType: 'Standard',
    fileMetadata: {
      isEncrypted: false,
      updated: Date.UTC(2026, 9, 12),
      payloads: [{ key: 'jrnl_txt' }],
      appData: { uniqueId: NOTE_ID, userDate: Date.UTC(2026, 9, 12), archivalStatus: 0, content: JSON.stringify({ title: NOTE_TITLE }) },
    },
  };
  await anonPage.route(`https://${AUTHOR}/api/guest/v1/drive/**`, (route) => {
    const url = new URL(route.request().url());
    const headers = {
      'access-control-allow-origin': new URL(anonPage.url()).origin,
      'access-control-allow-credentials': 'true',
      'access-control-expose-headers': 'decryptedcontenttype',
    };
    if (!url.pathname.endsWith('/payload')) {
      return route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
    }
    return url.searchParams.get('key') === 'jrnl_img0'
      ? route.fulfill({ contentType: 'image/svg+xml', headers: { ...headers, decryptedcontenttype: 'image/svg+xml' }, body: PICTURE })
      : route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() });
  });

  await anonPage.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(anonPage);
  const article = anonPage.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  const picture = article.getByRole('img', { name: 'Picture' });
  await expect.poll(() => picture.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await expectNoViolations(collector);
});
