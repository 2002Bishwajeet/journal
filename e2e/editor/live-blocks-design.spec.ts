import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #393: design pass for live blocks. Takes the screenshots the issue asks for,
// each kind × (editor, share page) × (light, dark) × (desktop 1280px, mobile 390px),
// and checks the layout promises a screenshot cannot show.

const THEMES = ['light', 'dark'] as const;
const KINDS = ['mermaid', 'svg', 'html'] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } } as const;

const SOURCES: Record<(typeof KINDS)[number], string> = {
  // Wider than a phone column, so the mobile shots show the sideways scroll.
  mermaid: [
    'graph LR',
    '  Draft[Write a draft] --> Review{Ready to share?}',
    '  Review -->|Yes| Publish[Publish the note]',
    '  Review -->|Not yet| Draft',
    '  Publish --> Readers[Readers open the link]',
  ].join('\n'),
  // Dark strokes on a transparent background: the art the dark theme must keep visible.
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120" fill="none" stroke="black" stroke-width="4"><rect x="10" y="10" width="100" height="100" rx="12"/><circle cx="180" cy="60" r="48"/><path d="M30 80l30-40 30 40"/></svg>',
  html: '<style>body{font-family:system-ui;margin:24px}button{font:inherit;padding:6px 12px}</style><h2>Counter</h2><p>Clicked <b id="n">0</b> times.</p><button onclick="n.textContent=+n.textContent+1">Add one</button>',
};
const BROKEN_MERMAID = 'graph LR\n  Draft[Write a draft --> Review';

// `--secondary` in src/index.css: what a flowchart node is filled with.
const NODE_FILL = { light: 'rgb(242, 240, 233)', dark: 'rgb(44, 43, 41)' } as const;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const liveBlock = (scope: Locator, kind: string) => scope.locator(`[data-live-block="${kind}"]`).first();
const diagram = (scope: Locator) => liveBlock(scope, 'mermaid').locator('svg[id^="mermaid-"]');

/** Screenshots one block with a little of the page around it. */
async function shoot(page: Page, block: Locator, name: string): Promise<void> {
  await block.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await block.boundingBox())!;
  const margin = 16;
  await page.screenshot({
    path: test.info().outputPath(name),
    clip: { x: box.x - margin, y: box.y - margin, width: box.width + 2 * margin, height: box.height + 2 * margin },
  });
}

/** Every kind is showing its preview. */
async function expectPreviews(scope: Locator): Promise<void> {
  await expect(diagram(scope)).toBeVisible({ timeout: 30_000 });
  await expect(liveBlock(scope, 'svg').locator('img')).toBeVisible();
  const frame = liveBlock(scope, 'html').locator('iframe');
  // The frame is lazy: it loads once it is near the viewport.
  await frame.scrollIntoViewIfNeeded();
  await expect(frame.contentFrame().getByRole('heading', { name: 'Counter' })).toBeVisible();
}

/** The layout promises of #393 that hold at every viewport. */
async function expectLayout(page: Page, scope: Locator, theme: (typeof THEMES)[number], codeToggle: string | null): Promise<void> {
  // The diagram follows the theme and keeps its natural size; its wrapper scrolls instead of overflowing.
  const drawn = await diagram(scope).evaluate((svg: SVGSVGElement) => ({
    width: svg.getBoundingClientRect().width,
    natural: svg.viewBox.baseVal.width,
    overflowX: getComputedStyle(svg.parentElement!).overflowX,
    nodeFill: getComputedStyle(svg.querySelector('.node rect')!).fill,
  }));
  expect(Math.abs(drawn.width - drawn.natural)).toBeLessThan(1);
  expect(drawn.overflowX).toBe('auto');
  expect(drawn.nodeFill).toBe(NODE_FILL[theme]);

  for (const kind of KINDS) {
    const box = (await liveBlock(scope, kind).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }

  // Switching an html block to its code and back does not move the page.
  const html = liveBlock(scope, 'html');
  // A reader of a public note has no toggle on an html block, so there is no code view to switch to:
  // its only control is Expand (#557).
  if (codeToggle === null) {
    await expect(html.getByRole('button')).toHaveText(['Expand']);
    return;
  }
  const toggle = html.getByRole('button', { name: codeToggle, exact: true });
  const previewHeight = (await html.boundingBox())!.height;
  await toggle.click();
  await expect(html.locator('pre code')).toBeVisible();
  expect((await html.boundingBox())!.height).toBe(previewHeight);
  await html.getByRole('button').first().click();
  await expect(html.locator('iframe')).toBeVisible();
  expect((await html.boundingBox())!.height).toBe(previewHeight);
}

/** On a phone every view toggle is a 44px touch target. */
async function expectTouchTargets(scope: Locator): Promise<void> {
  for (const button of await scope.locator('[data-live-block]').getByRole('button').all()) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
}

// Paste through the editor's real paste path (ProseMirror parses text/html).
// A pasted block has content when it mounts, so it starts in Preview.
async function pasteBlocks(page: Page, blocks: [language: string, code: string][]): Promise<void> {
  await assertTestOrigin(page);
  const editor = activeEditor(page);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  const html = blocks.map(([language, code]) => `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`).join('');
  await editor.evaluate((el, pasted) => {
    const data = new DataTransfer();
    data.setData('text/html', pasted);
    data.setData('text/plain', '');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, html);
  await expect(editor.locator('[data-live-block]')).toHaveCount(blocks.length);
}

for (const theme of THEMES) {
  test(`editor: mermaid, svg and html blocks, ${theme} theme`, async ({ app }) => {
    // The theme preference defaults to "system", which follows prefers-color-scheme.
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize(VIEWPORTS.desktop);
    await createNote(app, { title: `Live blocks ${theme} ${Date.now()}`, body: 'Live blocks in the editor.' });
    await pasteBlocks(app, [...KINDS.map((kind): [string, string] => [kind, SOURCES[kind]]), ['mermaid', BROKEN_MERMAID]]);
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));

    for (const viewport of ['desktop', 'mobile'] as const) {
      await app.setViewportSize(VIEWPORTS[viewport]);
      const editor = activeEditor(app);
      await expectPreviews(editor);
      await expectLayout(app, editor, theme, 'Code');
      if (viewport === 'mobile') await expectTouchTargets(editor);
      for (const kind of KINDS) await shoot(app, liveBlock(editor, kind), `${kind}-editor-${theme}-${viewport}.png`);
    }

    // The states the matrix above does not show.
    await app.setViewportSize(VIEWPORTS.desktop);
    const editor = activeEditor(app);
    const broken = editor.locator('[data-live-block="mermaid"]').nth(1);
    await expect(broken.getByRole('alert')).toBeVisible();
    await shoot(app, broken, `mermaid-error-editor-${theme}-desktop.png`);

    const html = liveBlock(editor, 'html');
    await html.getByRole('button', { name: 'Code', exact: true }).click();
    await shoot(app, html, `html-code-editor-${theme}-desktop.png`);

    // Keyboard focus: Shift+Tab from Code lands on Preview and shows its ring.
    await app.keyboard.press('Shift+Tab');
    await expect(html.getByRole('button', { name: 'Preview', exact: true })).toBeFocused();
    await shoot(app, html, `html-toggle-focus-editor-${theme}-desktop.png`);

    // A diagram on screen is redrawn in the new colours when the theme changes.
    const other = theme === 'light' ? 'dark' : 'light';
    await app.emulateMedia({ colorScheme: other });
    await expect
      .poll(() => diagram(editor).evaluate((svg) => getComputedStyle(svg.querySelector('.node rect')!).fill))
      .toBe(NODE_FILL[other]);
  });
}

// The share page reads a public note from its author's identity. There is no
// fake drive (#196): these are the three GETs of one read, answered with canned
// values on a *.homebase.test identity, which the network fence would otherwise
// abort. The profile lookups stay aborted, so the byline falls back to the identity.
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '3f0c9a52-6d1e-4b7a-9c35-2a8d4e6f1b90';
const NOTE_TITLE = 'Live blocks on the share page';
const PUBLISHED = Date.UTC(2026, 8, 30, 9, 0);

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push(
    KINDS.map((kind) => {
      const block = new Y.XmlElement('codeBlock');
      block.setAttribute('language', kind);
      block.insert(0, [new Y.XmlText(SOURCES[kind])]);
      return block;
    }),
  );
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function mockPublicNote(page: Page): Promise<void> {
  const header = {
    fileId: '0b6f2f3c-8a1d-4e55-b0c4-7d2f9a1e3c48',
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
    };
    return new URL(route.request().url()).pathname.endsWith('/payload')
      ? route.fulfill({ contentType: 'application/octet-stream', headers, body: noteContent() })
      : route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
  });
}

for (const theme of THEMES) {
  test(`share page: mermaid, svg and html blocks, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize(VIEWPORTS.desktop);
    await mockPublicNote(anonPage);
    await anonPage.goto(`/share/${AUTHOR}/${NOTE_ID}`);
    await assertTestOrigin(anonPage);
    const article = anonPage.getByRole('article');
    await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
    await expect(anonPage.locator('html')).toHaveClass(new RegExp(theme));

    for (const viewport of ['desktop', 'mobile'] as const) {
      await anonPage.setViewportSize(VIEWPORTS[viewport]);
      await expectPreviews(article);
      await expectLayout(anonPage, article, theme, null);
      if (viewport === 'mobile') await expectTouchTargets(article);
      for (const kind of KINDS) await shoot(anonPage, liveBlock(article, kind), `${kind}-share-${theme}-${viewport}.png`);
    }
  });
}
