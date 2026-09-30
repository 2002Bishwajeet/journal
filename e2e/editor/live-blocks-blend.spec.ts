import type { FrameLocator, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, createNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #420: a live block looks like part of the note. No card and no header bar, an
// `html` block's page takes the note's colours and font, and the view toggle
// stays out of sight until the block is hovered or has keyboard focus. Takes the
// screenshots the issue asks for: one note of every kind of block, in the editor
// and on the share page, light and dark, at 1280px and 390px.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } } as const;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const PARAGRAPH = 'A paragraph of the note, so the blocks below have something to blend into.';
const CALLOUT = 'A callout, one of the note’s own blocks.';
const TABLE = [
  ['Block', 'Drawn by'],
  ['Table', 'The note'],
];

// The two html sources of the issue, each on one line so typing it never leaves the code
// block. src/__tests__/agentEditEngine.test.ts sends the same two through the agent's path.
const UNSTYLED =
  '<h3>Reading list</h3><p>Three books for the trip, from <a href="#">the shared list</a>.</p><table><tr><th>Title</th><th>Pages</th></tr><tr><td>The Overstory</td><td>502</td></tr></table><button>Mark all read</button>';
const TOKEN_STYLED =
  '<div id="box" style="background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 16px"><strong>3 of 5 tasks done</strong><div style="color: var(--muted-foreground)">Two are waiting on review.</div></div>';

const FLOWCHART = [
  'graph LR',
  '  Draft[Write a draft] --> Review{Ready to share?}',
  '  Review -->|Yes| Publish[Publish the note]',
  '  Review -->|Not yet| Draft',
].join('\n');
const PIE = ['pie title Where the week went', '  "Writing" : 40', '  "Editing" : 25', '  "Review" : 20', '  "Publishing" : 15'].join('\n');
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120" fill="none" stroke="black" stroke-width="4"><rect x="10" y="10" width="100" height="100" rx="12"/><circle cx="180" cy="60" r="48"/><path d="M30 80l30-40 30 40"/></svg>';

// The live blocks of the note, in order: two html, two mermaid, one svg.
const LIVE_BLOCKS: [language: string, code: string][] = [
  ['html', UNSTYLED],
  ['html', TOKEN_STYLED],
  ['mermaid', FLOWCHART],
  ['mermaid', PIE],
  ['svg', SVG],
];

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A theme token (`#RRGGBB` in src/index.css) the way a computed style prints it. */
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const token = async (page: Page, name: string) =>
  rgb(await page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), name));
const firstFamily = (el: Element) => getComputedStyle(el).fontFamily.split(',')[0].trim();

const htmlFrame = (scope: Locator, nth = 0) => scope.locator('[data-live-block="html"] iframe').nth(nth).contentFrame();
const controlsOf = (block: Locator) => block.getByRole('group', { name: /block$/ });

/** The page in an html block's frame has the look of `paragraph`, a paragraph of the note around it. */
async function expectNoteLook(frame: FrameLocator, paragraph: Locator): Promise<void> {
  const body = frame.locator('body');
  await expect(frame.getByRole('heading', { name: 'Reading list' })).toBeVisible();
  await expect(body).toHaveCSS('color', await paragraph.evaluate((p) => getComputedStyle(p).color));
  await expect(body).toHaveCSS('background-color', TRANSPARENT);
  await expect(frame.locator('html')).toHaveCSS('background-color', TRANSPARENT);
  expect(await body.evaluate(firstFamily)).toBe(await paragraph.evaluate(firstFamily));
}

/** The token-styled box is drawn in the app's current `--muted` and `--border`. */
async function expectTokenColours(page: Page, frame: FrameLocator): Promise<void> {
  const box = frame.locator('#box');
  await expect(box).toHaveCSS('background-color', await token(page, '--muted'));
  await expect(box).toHaveCSS('border-top-color', await token(page, '--border'));
}

/** Every block of the note has drawn, and each html block has taken its content's height. */
async function expectDrawn(scope: Locator): Promise<void> {
  await expect(scope.locator('[data-live-block="mermaid"] svg[id^="mermaid-"]')).toHaveCount(2, { timeout: 30_000 });
  await expect(scope.locator('[data-live-block="svg"] img')).toBeVisible();
  for (const [nth, content] of [htmlFrame(scope, 0).getByRole('heading', { name: 'Reading list' }), htmlFrame(scope, 1).locator('#box')].entries()) {
    // A frame is lazy: it loads once it is near the viewport.
    const frame = scope.locator('[data-live-block="html"] iframe').nth(nth);
    await frame.scrollIntoViewIfNeeded();
    await expect(content).toBeVisible();
    // 400px is the height of a block whose content has not reported its own yet.
    await expect(frame.locator('xpath=..')).not.toHaveCSS('height', '400px');
  }
}

/**
 * No block has a card: a transparent background and no border. A reader (the share page) sees
 * nothing but the content until they hover; while editing, a plain row above the block names
 * its kind and holds the toggles.
 */
async function expectNoChrome(page: Page, scope: Locator, editing: boolean): Promise<void> {
  // Off every block, so none is hovered.
  await page.mouse.move(0, 0);
  const blocks = scope.locator('[data-live-block]');
  await expect(blocks).toHaveCount(LIVE_BLOCKS.length);
  for (const block of await blocks.all()) {
    await expect(block).toHaveCSS('background-color', TRANSPARENT);
    await expect(block).toHaveCSS('border-top-width', '0px');
    const controls = controlsOf(block);
    await expect(controls).toHaveCSS('background-color', TRANSPARENT);
    await expect(controls).toHaveCSS('border-top-width', '0px');
    const content = block.locator('> div').nth(1);
    const contentHeight = (await content.boundingBox())!.height;
    if (editing) {
      await expect(controls).toHaveCSS('position', 'static');
      await expect(controls).toHaveCSS('opacity', '1');
      await expect(controls.locator('> span')).toHaveText(/^(Mermaid|SVG|HTML)$/);
      expect((await block.boundingBox())!.height).toBe((await controls.boundingBox())!.height + contentHeight);
    } else {
      await expect(controls).toHaveCSS('position', 'absolute');
      await expect(controls).toHaveCSS('opacity', '0');
      await expect(controls.locator('> span')).toHaveCount(0);
      expect((await block.boundingBox())!.height).toBe(contentHeight);
    }
  }
}

/** A pie of four slices has four fills, and its legend is in the note's text colour. */
async function expectPie(page: Page, scope: Locator): Promise<void> {
  const pie = scope.locator('[data-live-block="mermaid"]').nth(1);
  const fills = await pie.locator('path.pieCircle').evaluateAll((slices) => slices.map((slice) => getComputedStyle(slice).fill));
  expect(fills).toHaveLength(4);
  expect(new Set(fills).size).toBe(4);
  await expect(pie.locator('.legend text').first()).toHaveCSS('fill', await token(page, '--foreground'));
}

/**
 * Screenshots the whole note. A sandboxed frame only paints inside the viewport, so the
 * viewport is made as tall as the note (which scrolls in the page or in a pane of the app)
 * instead of using `fullPage`. `top` is the first thing of the note, to scroll back to.
 */
async function shoot(page: Page, scope: Locator, top: Locator, name: string): Promise<void> {
  await page.mouse.move(0, 0);
  const viewport = page.viewportSize()!;
  const scrolledOut = await scope.evaluate((el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node.scrollHeight - node.clientHeight;
    }
    return document.documentElement.scrollHeight - window.innerHeight;
  });
  await page.setViewportSize({ width: viewport.width, height: viewport.height + Math.max(scrolledOut, 0) });
  await top.scrollIntoViewIfNeeded();
  // A frame paints again a moment after the resize: a screenshot taken before that shows it blank.
  for (const nth of [0, 1]) {
    const body = htmlFrame(scope, nth).locator('body');
    await expect(body).toBeVisible();
    await body.evaluate(() => new Promise<void>((painted) => requestAnimationFrame(() => requestAnimationFrame(() => painted()))));
  }
  await page.screenshot({ path: test.info().outputPath(name) });
  await page.setViewportSize(viewport);
}

// The synthetic paste of e2e/editor/live-paste.spec.ts: plain text into the empty line the caret is on.
async function pastePlainText(app: Page, text: string): Promise<void> {
  await assertTestOrigin(app);
  await activeEditor(app).evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

const ENTRIES = {
  // Bare markup pasted into an empty line becomes an html block, in Preview.
  pasted: async (app: Page, source: string) => {
    await app.keyboard.press('Enter');
    await pastePlainText(app, source);
  },
  // A block typed after ```html starts in Code.
  typed: async (app: Page, source: string) => {
    await app.keyboard.press('Enter');
    await app.keyboard.type('```html ' + source);
    await activeEditor(app).getByRole('button', { name: 'Preview', exact: true }).click();
  },
} as const;

/** A new note of one paragraph and one html block made through `entry`. Returns the block's frame. */
async function noteWithHtmlBlock(app: Page, entry: keyof typeof ENTRIES, source: string): Promise<FrameLocator> {
  await createNote(app, { title: `Blend ${entry} ${Date.now()}`, body: PARAGRAPH });
  await ENTRIES[entry](app, source);
  await expect(activeEditor(app).locator('[data-live-block="html"]')).toHaveCount(1);
  return htmlFrame(activeEditor(app));
}

for (const theme of THEMES) {
  for (const entry of ['pasted', 'typed'] as const) {
    test(`editor: an html block ${entry} into a note takes the note's look, ${theme} theme`, async ({ app }) => {
      // The theme preference defaults to "system", which follows prefers-color-scheme.
      await app.emulateMedia({ colorScheme: theme });
      await expect(app.locator('html')).toHaveClass(new RegExp(theme));

      const unstyled = await noteWithHtmlBlock(app, entry, UNSTYLED);
      await expectNoteLook(unstyled, activeEditor(app).getByText(PARAGRAPH));
      await expect(unstyled.locator('html')).toHaveCSS('color-scheme', theme);

      const styled = await noteWithHtmlBlock(app, entry, TOKEN_STYLED);
      await expectTokenColours(app, styled);
      const before = await token(app, '--muted');

      // The page is rebuilt in the new theme's values.
      const other = theme === 'light' ? 'dark' : 'light';
      await app.emulateMedia({ colorScheme: other });
      await expect(app.locator('html')).toHaveClass(new RegExp(other));
      expect(await token(app, '--muted')).not.toBe(before);
      await expectTokenColours(app, styled);
      await expect(styled.locator('body')).toHaveCSS('color', await token(app, '--foreground'));
    });
  }
}

test('editor: the block is labelled and its toggles stay in view, with the pointer and focus elsewhere', async ({ app }) => {
  await noteWithHtmlBlock(app, 'pasted', TOKEN_STYLED);
  const block = activeEditor(app).locator('[data-live-block="html"]');
  const controls = controlsOf(block);
  await expect(htmlFrame(activeEditor(app)).locator('#box')).toBeVisible();

  // Pointer and focus both off the block.
  await activeTitleInput(app).click();
  await expect(controls).toHaveCSS('opacity', '1');
  await expect(controls.getByText('HTML', { exact: true })).toBeVisible();
  await expect(block.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();

  // The Tab key moves between the toggles.
  await block.getByRole('button', { name: 'Code', exact: true }).click();
  await app.keyboard.press('Shift+Tab');
  await expect(block.getByRole('button', { name: 'Preview', exact: true })).toBeFocused();
  await app.screenshot({ path: test.info().outputPath('toggle-focus-editor-light-1280.png') });
});

for (const theme of THEMES) {
  test(`editor: a note of every kind of block has no card around any of them, ${theme} theme`, async ({ app }) => {
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize(VIEWPORTS[1280]);
    await createNote(app, { title: `Blend ${theme} ${Date.now()}`, body: PARAGRAPH });

    // Through the editor's real paste path (ProseMirror parses text/html).
    const editor = activeEditor(app);
    await app.keyboard.press('Enter');
    await assertTestOrigin(app);
    await editor.evaluate(
      (el, pasted) => {
        const data = new DataTransfer();
        data.setData('text/html', pasted);
        data.setData('text/plain', '');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      },
      [
        `<div data-type="callout" data-variant="info"><p>${CALLOUT}</p></div>`,
        `<table>${TABLE.map((row, r) => `<tr>${row.map((cell) => (r === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`)).join('')}</tr>`).join('')}</table>`,
        ...LIVE_BLOCKS.map(([language, code]) => `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`),
      ].join(''),
    );
    await expect(editor.locator('[data-type="callout"]')).toContainText(CALLOUT);
    await expect(editor.getByRole('table')).toBeVisible();
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));

    for (const width of [1280, 390] as const) {
      await app.setViewportSize(VIEWPORTS[width]);
      await expectDrawn(editor);
      await expectNoChrome(app, editor, true);
      await expectPie(app, editor);
      await shoot(app, editor, activeTitleInput(app), `note-editor-${theme}-${width}.png`);
    }
  });
}

// The share page reads a public note from its author's identity. There is no
// fake drive (#196): these are the GETs of one read, answered with canned values
// on a *.homebase.test identity, which the network fence would otherwise abort.
// Same approach as e2e/editor/live-blocks-design.spec.ts (#393). The profile
// lookups stay aborted, so the byline falls back to the identity.
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '9b2e6f14-5c7a-4d83-b1e9-3a4f8c0d7e52';
const NOTE_TITLE = 'Live blocks that blend into the note';
const PUBLISHED = Date.UTC(2026, 8, 30, 9, 0);

function element(name: string, children: (Y.XmlElement | Y.XmlText)[], attributes: Record<string, string> = {}): Y.XmlElement {
  const el = new Y.XmlElement(name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  el.insert(0, children);
  return el;
}

const paragraph = (text: string) => element('paragraph', [new Y.XmlText(text)]);

/** The note the editor test pastes, as the Yjs document the share page reads. */
function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push([
    paragraph(PARAGRAPH),
    element('callout', [paragraph(CALLOUT)], { variant: 'info' }),
    element(
      'table',
      TABLE.map((row, r) => element('tableRow', row.map((cell) => element(r === 0 ? 'tableHeader' : 'tableCell', [paragraph(cell)])))),
    ),
    ...LIVE_BLOCKS.map(([language, code]) => element('codeBlock', [new Y.XmlText(code)], { language })),
  ]);
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function mockPublicNote(page: Page): Promise<void> {
  const header = {
    fileId: '6d3a9e27-1f4b-4c68-9a05-8e7b2c1d4f93',
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
  test(`share page: the same note has the same look, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize(VIEWPORTS[1280]);
    await mockPublicNote(anonPage);
    await anonPage.goto(`/share/${AUTHOR}/${NOTE_ID}`);
    await assertTestOrigin(anonPage);
    const article = anonPage.getByRole('article');
    await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
    await expect(anonPage.locator('html')).toHaveClass(new RegExp(theme));
    await expect(article.getByRole('note')).toContainText(CALLOUT);
    await expect(article.getByRole('table')).toBeVisible();

    for (const width of [1280, 390] as const) {
      await anonPage.setViewportSize(VIEWPORTS[width]);
      await expectDrawn(article);
      await expectNoChrome(anonPage, article, false);
      await expectPie(anonPage, article);
      await expectNoteLook(htmlFrame(article, 0), article.getByText(PARAGRAPH));
      await expectTokenColours(anonPage, htmlFrame(article, 1));
      await shoot(anonPage, article, article.getByRole('heading', { level: 1 }), `note-share-${theme}-${width}.png`);
    }

    // The toggle: out of sight, there on hover, and there when the Tab key reaches it.
    await anonPage.setViewportSize(VIEWPORTS[1280]);
    const block = article.locator('[data-live-block="html"]').first();
    const controls = controlsOf(block);
    const toggle = block.getByRole('button', { name: 'View source', exact: true });
    await block.scrollIntoViewIfNeeded();
    await anonPage.mouse.move(0, 0);
    await expect(controls).toHaveCSS('opacity', '0');
    await block.hover();
    await expect(controls).toHaveCSS('opacity', '1');
    await anonPage.mouse.move(0, 0);
    await expect(controls).toHaveCSS('opacity', '0');

    // It is the first control of the first live block: nothing in a frame is tabbed through on the way.
    for (let presses = 0; presses < 30 && !(await toggle.evaluate((el) => el === document.activeElement)); presses++) {
      await anonPage.keyboard.press('Tab');
    }
    await expect(toggle).toBeFocused();
    await expect(controls).toHaveCSS('opacity', '1');
    await anonPage.screenshot({ path: test.info().outputPath(`toggle-focus-share-${theme}-1280.png`) });
  });
}
