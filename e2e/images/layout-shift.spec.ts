import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, reloadNote, waitForNoteSaved, screenshotInBothThemes } from '../support/actions';
import { makeSolidPng } from '../support/png';

// #1387: an image in a note stores its pixel size when it is added, so on opening the note
// every image holds its final box from the first render and scrolling through a note with
// pictures below the fold moves nothing (cumulative layout shift under 0.01). Pictures of
// three shapes; screenshots desktop and phone, both themes.
// The share page's own spec (publishing/share-image-layout-shift.spec.ts) holds the
// bytes back to photograph the placeholder phase.

const PICTURES = [
  { name: 'wide.png', width: 900, height: 450, color: [143, 163, 173] },
  { name: 'tall.png', width: 600, height: 800, color: [113, 137, 104] },
  { name: 'square.png', width: 700, height: 700, color: [190, 120, 90] },
] as const;
const TEXT = 'A paragraph of text between the pictures, so each one sits below the fold of the page. '.repeat(14);

/** Sums the page's layout shifts not caused by input, from the first paint of each load. */
async function watchLayoutShift(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cls: number };
    w.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) w.__cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}
const layoutShift = (page: Page) => page.evaluate(() => (window as unknown as { __cls: number }).__cls);

/** Drops one picture in a new paragraph at the end of the note, then types a long paragraph after it. */
async function dropPicture(page: Page, picture: (typeof PICTURES)[number]) {
  const editor = activeEditor(page);
  await editor.press('ControlOrMeta+End');
  await editor.press('Enter');
  const last = (await editor.locator('p').last().boundingBox())!;
  await editor.evaluate(
    (el, { name, base64, x, y }) => {
      const data = new DataTransfer();
      data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name, { type: 'image/png' }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    {
      name: picture.name,
      base64: makeSolidPng(picture.width, picture.height, [...picture.color]).toString('base64'),
      x: last.x + last.width - 1,
      y: last.y + last.height / 2,
    },
  );
  await expect(editor.locator('.image-node')).toHaveCount(PICTURES.indexOf(picture) + 1);
  await editor.press('ControlOrMeta+End');
  await editor.press('Enter');
  await page.keyboard.insertText(TEXT);
}

/** Scrolls the open note's editor through in screen-sized steps. */
async function scrollThrough(editor: Locator): Promise<void> {
  const page = editor.page();
  const step = page.viewportSize()!.height - 100;
  const scroller = await editor.evaluateHandle((el) => {
    for (let node: HTMLElement | null = el; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 1 && getComputedStyle(node).overflowY !== 'visible') return node;
    }
    return document.scrollingElement as HTMLElement;
  });
  const height = await scroller.evaluate((el: HTMLElement) => el.scrollHeight);
  for (let y = 0; y < height; y += step) {
    await scroller.evaluate((el: HTMLElement, top) => el.scrollTo(0, top), y);
    // Nothing observable settles a scroll position; one frame is all a layout shift needs to show
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
}

test('editor: images below the fold hold their box and nothing shifts while scrolling', async ({ app }) => {
  test.slow();
  await app.setViewportSize({ width: 1280, height: 800 });
  await watchLayoutShift(app);
  await createNote(app, { title: `Layout shift ${Date.now()}`, body: TEXT });
  for (const picture of PICTURES) await dropPicture(app, picture);
  await waitForNoteSaved(app);

  // Each node stores its picture's own size, apart from any display width
  const { doc } = (await app.evaluate(() => window.__journalE2E!.openNoteJSON()))!;
  const stored: Record<string, unknown>[] = [];
  const collect = (node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
    if (node.type === 'image') stored.push(node.attrs ?? {});
    (node.content as (typeof node)[] | undefined)?.forEach(collect);
  };
  collect(doc as Parameters<typeof collect>[0]);
  expect(stored.map((a) => [a.naturalWidth, a.naturalHeight])).toEqual(PICTURES.map((p) => [p.width, p.height]));

  // Reopen: the pictures come back from the queue and the device's copies, one frame at a time
  await reloadNote(app);
  const editor = activeEditor(app);
  await expect(editor.locator('.image-node')).toHaveCount(PICTURES.length);
  await app.evaluate(() => ((window as unknown as { __cls: number }).__cls = 0));
  const tops = () => editor.locator('.image-node').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top + window.scrollY)));
  await scrollThrough(editor);
  for (const [i, picture] of PICTURES.entries()) {
    const image = editor.locator('.image-node').nth(i);
    await image.scrollIntoViewIfNeeded();
    // Held in its own aspect ratio, loaded or not
    await expect(async () => {
      const box = (await image.locator('img').first().boundingBox())!;
      expect(box.width / box.height).toBeCloseTo(picture.width / picture.height, 1);
    }).toPass();
    await expect.poll(() => image.locator('img').first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(picture.width);
  }
  const settled = await tops();
  await scrollThrough(editor);
  expect(await tops()).toEqual(settled);
  expect(await layoutShift(app)).toBeLessThan(0.01);

  await editor.locator('.image-node').first().scrollIntoViewIfNeeded();
  await screenshotInBothThemes(app, (theme) => `layout-shift-editor-loaded-${theme}-1280.png`);
  await app.setViewportSize({ width: 390, height: 844 });
  await editor.locator('.image-node').nth(1).scrollIntoViewIfNeeded();
  await app.screenshot({ path: test.info().outputPath('layout-shift-editor-loaded-dark-390.png') });
});
