import { readFile } from 'node:fs/promises';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, pastePlainText } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #557: an html or react block can ask for the full width of the pane with `wide` in its
// fence, and any of them can be shown fullscreen (the same running frame, so its state
// stays), in the editor and on the share page. Takes the screenshots the issue asks for:
// light and dark, 1280px and 390px.

const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = { 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } } as const;
// The side gutter a wide block keeps: the editor column's own padding, px-6 and md:px-12.
const GUTTER = { 1280: 48, 390: 24 } as const;

const PARAGRAPH = 'The note column keeps prose at a reading measure; a wide block takes the whole pane.';

// A counter that keeps its count with journal.storage (#410).
const COUNTER = [
  '<style>body{margin:16px}</style>',
  '<p id="out">loading</p>',
  '<button id="add">Add one</button>',
  '<script>',
  "const out = document.getElementById('out');",
  'let count = 0;',
  "journal.storage.get('count').then((saved) => { count = saved ?? 0; out.textContent = 'count: ' + count; });",
  "document.getElementById('add').onclick = () => { count += 1; out.textContent = 'count: ' + count; journal.storage.set('count', count); };",
  '</script>',
].join('\n');

const htmlFrame = (block: Locator): FrameLocator => block.frameLocator('iframe[title="HTML preview"]');
// The block's box, which is the popover that goes fullscreen.
const boxOf = (block: Locator) => block.locator('[popover]');
const isFullscreen = (block: Locator) => boxOf(block).evaluate((el) => el.matches(':popover-open'));

/** The pane a wide block takes its width from (`@container/live-blocks`), as its content box. */
const paneOf = (block: Locator) =>
  block.evaluate((el) => {
    let pane = el.parentElement;
    while (pane && !getComputedStyle(pane).containerName.includes('live-blocks')) pane = pane.parentElement;
    const rect = pane!.getBoundingClientRect();
    return { left: rect.left + pane!.clientLeft, width: pane!.clientWidth, scrolls: pane!.scrollWidth > pane!.clientWidth };
  });

const box = async (locator: Locator) => (await locator.boundingBox())!;

/** The wide block spans its pane, less the gutter on each side, and nothing scrolls sideways. */
async function expectWide(page: Page, block: Locator, paragraph: Locator, viewport: keyof typeof VIEWPORTS): Promise<void> {
  const pane = await paneOf(block);
  const wide = await box(block);
  const column = await box(paragraph);
  const margins = [wide.x - pane.left, pane.left + pane.width - (wide.x + wide.width)];
  if (viewport === 1280) {
    for (const margin of margins) expect(margin).toBeCloseTo(GUTTER[viewport], 0);
    expect(wide.width).toBeGreaterThan(column.width + 32);
  } else {
    // A phone: the block fills the width, which is the column's where the page's own margin is narrower than the gutter.
    for (const margin of margins) expect(margin).toBeLessThanOrEqual(GUTTER[viewport] + 0.5);
    expect(wide.width).toBeGreaterThanOrEqual(column.width);
  }
  expect(pane.scrolls).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Expand shows the same running frame over the whole viewport; Esc in the frame, Esc in the page and Close all return. */
async function expectFullscreen(page: Page, block: Locator, shot: string): Promise<void> {
  const frame = htmlFrame(block);
  const out = frame.locator('#out');
  const before = (await out.textContent())!;
  const count = Number(before.replace('count: ', ''));
  // A mark in the frame's document: still there afterwards only if the frame never reloaded.
  await frame.locator('body').evaluate((body) => body.setAttribute('data-mark', 'kept'));

  await block.hover();
  await block.getByRole('button', { name: 'Expand' }).click();
  expect(await isFullscreen(block)).toBe(true);
  const viewport = page.viewportSize()!;
  expect(await box(boxOf(block))).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
  const close = block.getByRole('button', { name: 'Close' });
  await expect(close).toBeFocused();
  await expect(frame.locator('body')).toHaveAttribute('data-mark', 'kept');
  await expect(out).toHaveText(before);

  // Focus is in the frame now: its Esc is passed on to the app.
  await frame.getByRole('button', { name: 'Add one' }).click();
  await expect(out).toHaveText(`count: ${count + 1}`);
  await page.screenshot({ path: test.info().outputPath(shot) });
  await page.keyboard.press('Escape');
  await expect.poll(() => isFullscreen(block)).toBe(false);
  await expect(close).toHaveCount(0);
  await expect(out).toHaveText(`count: ${count + 1}`);
  await expect(frame.locator('body')).toHaveAttribute('data-mark', 'kept');

  // Esc with focus in the page, then Close.
  await block.hover();
  await block.getByRole('button', { name: 'Expand' }).click();
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect.poll(() => isFullscreen(block)).toBe(false);
  await block.hover();
  await block.getByRole('button', { name: 'Expand' }).click();
  await close.click();
  await expect.poll(() => isFullscreen(block)).toBe(false);
  await expect(out).toHaveText(`count: ${count + 1}`);
}

for (const theme of THEMES) {
  test(`editor: a wide html block spans the pane, goes fullscreen with its state, and keeps wide in its markdown, ${theme} theme`, async ({ app }) => {
    // The theme preference defaults to "system", which follows prefers-color-scheme.
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize(VIEWPORTS[1280]);
    const title = `Wide block ${theme} ${Date.now()}`;
    await createNote(app, { title, body: PARAGRAPH });
    await app.keyboard.press('Enter');
    await pastePlainText(app, '```html wide\n' + COUNTER + '\n```');
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));

    const editor = activeEditor(app);
    const block = editor.locator('[data-live-block="html"]');
    const paragraph = editor.getByText(PARAGRAPH);
    await expect(block).toHaveAttribute('data-live-block-wide', '');
    await expect(htmlFrame(block).locator('#out')).toHaveText('count: 0');
    // The note's tab in the desktop tab bar: gone in the mobile layout.
    const closeTab = app.getByRole('button', { name: `Close ${title}`, exact: true });
    await expect(closeTab).toBeVisible();

    for (const viewport of [1280, 390] as const) {
      await app.setViewportSize(VIEWPORTS[viewport]);
      if (viewport === 390) {
        // Below 768px the app swaps to its mobile layout: the desktop tab bar goes, and the
        // note remounts in the router outlet with a new frame. Wait for that remount, then for
        // the new frame to have loaded its count, before measuring.
        await expect(closeTab).toBeHidden();
        await expect(app.getByText('Loading document...')).toHaveCount(0);
      }
      await expect(htmlFrame(block).locator('#out')).toHaveText(/^count: \d+$/);
      // The layout settles over a few frames (the sidebar's transition); measure until it has.
      await expect(() => expectWide(app, block, paragraph, viewport)).toPass();
      await block.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await app.screenshot({ path: test.info().outputPath(`wide-editor-${theme}-${viewport}.png`) });
      await expectFullscreen(app, block, `fullscreen-editor-${theme}-${viewport}.png`);
    }

    // The count the block saved, in and out of fullscreen, is in the note. Same wait as
    // e2e/editor/live-html-storage.spec.ts: the save reaches PGlite a moment after the note.
    await app.setViewportSize(VIEWPORTS[1280]);
    await app.waitForTimeout(1500);
    await app.reload();
    await waitForAppReady(app);
    await expect(htmlFrame(activeEditor(app).locator('[data-live-block="html"]')).locator('#out')).toHaveText('count: 2');

    // `wide` stays in the fence, next to the id the block got on its first save. The rest of
    // the round trip (get_note, update_note) is in src/__tests__/liveBlockState.test.ts.
    const [download] = await Promise.all([
      app.waitForEvent('download'),
      (async () => {
        await app.getByRole('button').filter({ hasText: title }).first().click({ button: 'right' });
        await app.getByRole('menuitem', { name: 'Export to Markdown' }).click();
      })(),
    ]);
    const markdown = await readFile(await download.path(), 'utf8');
    expect(markdown).toMatch(/^```html wide id=[a-z0-9]{8}\n<style>body\{margin:16px\}<\/style>$/m);
  });
}

// The share page reads a public note from its author's identity: the GETs of one read,
// answered with canned values on a *.homebase.test identity, as in e2e/editor/live-html-storage.spec.ts.
const AUTHOR = 'e2e-author.homebase.test';
const NOTE_ID = '8d2f4a61-7c3e-4b90-a1d5-6e9f0b2c3d47';
const FILE_ID = '2a7c9e14-5b3d-4f68-9e0a-1c2d3e4f5a6b';
const NOTE_TITLE = 'A wide block on the share page';

/** The note as the owner saved it: a paragraph, then the wide block with its state `{ count: 3 }`. */
function sharedNoteContent(): Buffer {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(PARAGRAPH)]);
  const code = new Y.XmlElement('codeBlock');
  code.setAttribute('language', 'html wide id=k3f9');
  code.insert(0, [new Y.XmlText(COUNTER)]);
  doc.getXmlFragment('prosemirror').push([paragraph, code]);
  doc.getMap('liveBlockState').set('k3f9', JSON.stringify({ count: 3 }));
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

async function openSharedNote(page: Page): Promise<Locator> {
  const published = Date.UTC(2026, 9, 9, 9, 0);
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
      ? route.fulfill({ contentType: 'application/octet-stream', headers, body: sharedNoteContent() })
      : route.fulfill({ contentType: 'application/json', headers, body: JSON.stringify(header) });
  });
  await page.goto(`/share/${AUTHOR}/${NOTE_ID}`);
  await assertTestOrigin(page);
  const article = page.getByRole('article');
  await expect(article.getByRole('heading', { level: 1, name: NOTE_TITLE })).toBeVisible({ timeout: 15_000 });
  return article;
}

for (const theme of THEMES) {
  test(`share page: a wide html block spans the page and goes fullscreen with the owner's state, ${theme} theme`, async ({ anonPage }) => {
    await anonPage.emulateMedia({ colorScheme: theme });
    await anonPage.setViewportSize(VIEWPORTS[1280]);
    const article = await openSharedNote(anonPage);
    await expect(anonPage.locator('html')).toHaveClass(new RegExp(theme));
    const block = article.locator('[data-live-block="html"]');
    const paragraph = article.getByText(PARAGRAPH);
    await expect(block).toHaveAttribute('data-live-block-wide', '');
    // The frame is lazy: it loads once it is near the viewport.
    await block.scrollIntoViewIfNeeded();
    await expect(htmlFrame(block).locator('#out')).toHaveText('count: 3');

    for (const viewport of [1280, 390] as const) {
      await anonPage.setViewportSize(VIEWPORTS[viewport]);
      await expect(htmlFrame(block).locator('#out')).toHaveText(/^count: \d+$/);
      await expect(() => expectWide(anonPage, block, paragraph, viewport)).toPass();
      await block.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await anonPage.screenshot({ path: test.info().outputPath(`wide-share-${theme}-${viewport}.png`) });
      await expectFullscreen(anonPage, block, `fullscreen-share-${theme}-${viewport}.png`);
    }
    // The reader's own count: started from the owner's 3, one added in each fullscreen.
    await expect(htmlFrame(block).locator('#out')).toHaveText('count: 5');
  });
}
