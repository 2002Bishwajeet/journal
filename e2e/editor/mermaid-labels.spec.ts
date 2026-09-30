import type { Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #432: no Mermaid label is clipped. Mermaid sizes each node from the label it measured,
// then draws the label as HTML in a <foreignObject> of that size; a label that lays out
// differently in the note than it did when measured overflows its box and is cut off.
// Checks every <foreignObject> of a note of every diagram type, in the editor and on the
// share page, light and dark, and takes a screenshot of the flowchart and the sequence diagram.

const THEMES = ['light', 'dark'] as const;

// A diamond whose label wraps to three or more lines, a long edge label, and a rectangle with a <br>.
const FLOWCHART = [
  'graph TD',
  '  A[Start] --> B{Does it trigger? 1:1 message, tag or nickname}',
  '  B -->|Yes, when the message arrives in a shared channel that nobody has muted| C[First line<br>Second line<br>Third line]',
  '  B -->|No| D([A stadium node with a rather long label for testing])',
  '  C --> E(A round node with a long label too, so it has to wrap)',
].join('\n');
const SEQUENCE = [
  'sequenceDiagram',
  '  participant A as Alice the author of the note',
  '  participant B as Bob the reviewer',
  '  A->>B: A rather long message that goes on and on across the whole diagram',
  '  Note over A,B: A long note that explains what is going on between these two participants',
].join('\n');
const CLASS = [
  'classDiagram',
  '  class Notebook {',
  '    +String aVeryLongPropertyNameThatGoesOnAndOn',
  '    +renderTheWholeNoteWithAllItsBlocks(options) String',
  '  }',
  '  Notebook --> Page : contains many pages with long labels',
].join('\n');
const STATE = [
  'stateDiagram-v2',
  '  [*] --> WaitingForTheReviewerToLookAtIt',
  '  WaitingForTheReviewerToLookAtIt --> Approved : the reviewer agrees with every change in the note',
  '  Approved --> [*]',
].join('\n');

const DIAGRAMS = [
  { name: 'flowchart', source: FLOWCHART },
  { name: 'sequence', source: SEQUENCE },
  { name: 'class', source: CLASS },
  { name: 'state', source: STATE },
];

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Every label of a rendered diagram fits the <foreignObject> Mermaid made for it. */
async function expectNoClippedLabels(block: Locator, minLabels: number): Promise<void> {
  const labels = block.locator('svg foreignObject');
  if (minLabels > 0) await expect(labels.first()).toBeAttached();
  const { count, clipped } = await labels.evaluateAll((objects) => {
    const clipped: string[] = [];
    for (const fo of objects) {
      const box = fo.getBoundingClientRect();
      const inner = fo.firstElementChild as HTMLElement | null;
      if (!inner) continue;
      // The size Mermaid gave the box is its attributes, in the svg's own units.
      const width = parseFloat(fo.getAttribute('width') ?? '0');
      const height = parseFloat(fo.getAttribute('height') ?? '0');
      if (inner.scrollHeight > height + 1 || inner.scrollWidth > width + 1) {
        clipped.push(
          `"${(inner.textContent ?? '').trim()}": content ${inner.scrollWidth}x${inner.scrollHeight}, box ${width}x${height} (drawn ${Math.round(box.width)}x${Math.round(box.height)})`,
        );
      }
    }
    return { count: objects.length, clipped };
  });
  expect(count).toBeGreaterThanOrEqual(minLabels);
  expect(clipped).toEqual([]);
}

/** A sequence diagram draws its labels as svg text: each note's text lies inside the note's box. */
async function expectSequenceNotesFit(block: Locator): Promise<void> {
  const outside = await block.evaluate((el) => {
    const notes = [...el.querySelectorAll<SVGRectElement>('rect.note')];
    const texts = [...el.querySelectorAll<SVGTextElement>('text.noteText')];
    const out = texts.filter((text, i) => {
      const t = text.getBoundingClientRect();
      const n = notes[i].getBoundingClientRect();
      return t.left < n.left - 1 || t.right > n.right + 1 || t.top < n.top - 1 || t.bottom > n.bottom + 1;
    });
    return { notes: notes.length, texts: texts.length, outside: out.map((text) => text.textContent) };
  });
  expect(outside.notes).toBeGreaterThan(0);
  expect(outside.notes).toBe(outside.texts);
  expect(outside.outside).toEqual([]);
}

/** Every diagram of the note has drawn, then none of them clips a label. */
async function expectNoteLabelsFit(scope: Locator): Promise<void> {
  const blocks = scope.locator('[data-live-block="mermaid"]');
  await expect(blocks).toHaveCount(DIAGRAMS.length);
  await expect(scope.locator('[data-live-block="mermaid"] svg[id^="mermaid-"]')).toHaveCount(DIAGRAMS.length, { timeout: 30_000 });
  // The sequence diagram draws its labels as svg text: it has no <foreignObject> to check.
  const minLabels = { flowchart: 5, sequence: 0, class: 1, state: 1 };
  for (const [nth, { name }] of DIAGRAMS.entries()) {
    await blocks.nth(nth).scrollIntoViewIfNeeded();
    await expectNoClippedLabels(blocks.nth(nth), minLabels[name as keyof typeof minLabels]);
    if (name === 'sequence') await expectSequenceNotesFit(blocks.nth(nth));
  }
}

async function shoot(page: Page, scope: Locator, where: string, theme: string): Promise<void> {
  await page.mouse.move(0, 0);
  for (const nth of [0, 1]) {
    const block = scope.locator('[data-live-block="mermaid"]').nth(nth);
    await block.scrollIntoViewIfNeeded();
    await block.screenshot({ path: test.info().outputPath(`${DIAGRAMS[nth].name}-${where}-${theme}.png`) });
  }
}

for (const theme of THEMES) {
  test(`editor: no mermaid label is clipped, ${theme} theme`, async ({ app }) => {
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize({ width: 1280, height: 900 });
    await createNote(app, { title: `Mermaid labels ${theme} ${Date.now()}`, body: 'Diagrams with long labels.' });
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
      DIAGRAMS.map(({ source }) => `<pre><code class="language-mermaid">${escapeHtml(source)}</code></pre>`).join(''),
    );
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));
    await expectNoteLabelsFit(editor);
    await shoot(app, editor, 'editor', theme);
  });
}

// The share page reads a public note from its author's identity. There is no fake drive (#196):
// the GETs of one read are answered with canned values on a *.homebase.test identity, as in
// e2e/editor/live-blocks-blend.spec.ts.
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '4c1d7a52-8e3b-4f96-a0d5-2b9e6c7f1a38';
const NOTE_TITLE = 'Mermaid labels that fit';
const PUBLISHED = Date.UTC(2026, 8, 30, 9, 0);

function noteContent(): Buffer {
  const doc = new Y.Doc();
  doc.getXmlFragment('prosemirror').push(
    DIAGRAMS.map(({ source }) => {
      const block = new Y.XmlElement('codeBlock');
      block.setAttribute('language', 'mermaid');
      block.insert(0, [new Y.XmlText(source)]);
      return block;
    }),
  );
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function mockPublicNote(page: Page): Promise<void> {
  const header = {
    fileId: '0e8b5c31-7a4d-4b29-9f60-d3a1c2e5b874',
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

for (const theme of THEMES) {
  test(`share page: no mermaid label is clipped, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize({ width: 1280, height: 900 });
    await mockPublicNote(anonPage);
    await anonPage.goto(`/share/${AUTHOR}/${NOTE_ID}`);
    await assertTestOrigin(anonPage);
    const article = anonPage.getByRole('article');
    await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
    await expect(anonPage.locator('html')).toHaveClass(new RegExp(theme));
    await expectNoteLabelsFit(article);
    await shoot(anonPage, article, 'share', theme);
  });
}
