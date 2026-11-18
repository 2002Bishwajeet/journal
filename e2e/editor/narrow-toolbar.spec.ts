import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, screenshotInBothThemes, waitForNoteSaved } from '../support/actions';

// A mouse or trackpad in a narrow window (a Mac with the window dragged small) gets the same editing
// controls as at full width, and layout still follows the width (#1392). The hermetic project is a
// desktop Chromium: fine pointer, no touch. The toolbar compacts into a More menu instead of wrapping
// or scrolling, the selection bubble shows, and focus mode hides the toolbar but not the bubble.

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });
const more = (page: Page) => toolbar(page).getByRole('button', { name: 'More' });
const toolbarBold = (page: Page) => toolbar(page).getByTitle('Bold (Cmd+B)');
const bubbleBold = (page: Page) => page.getByTitle('Bold', { exact: true });

// Create a note at a wide size and wait until its own editor shows the body, so a later resize
// or selection never races a note that is still opening (#1398).
async function createWideNote(page: Page, title: string, body: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await createNote(page, { title, body });
  await waitForNoteSaved(page);
  await expect(activeEditor(page)).toContainText(body);
}

async function openNarrow(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await expect(activeEditor(page)).toBeVisible();
}

async function selectAll(page: Page): Promise<void> {
  await activeEditor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
}

test('narrow window: the toolbar compacts into More and the selection bubble shows', async ({ app }) => {
  await createWideNote(app, `Narrow ${Date.now()}`, 'Narrow window body');

  for (const width of [900, 700, 420]) {
    await test.step(`at ${width}px the toolbar is one row with a More menu`, async () => {
      await openNarrow(app, width);
      await expect(toolbar(app)).toBeVisible();
      await expect(more(app)).toBeVisible();
      const fit = await toolbar(app).evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, height: el.clientHeight }));
      expect(fit.scroll).toBeLessThanOrEqual(fit.client);
      const undo = (await toolbar(app).getByTitle('Undo (Cmd+Z)').boundingBox())!;
      expect(fit.height).toBeLessThan(undo.height * 2);
      // Nothing sticks out past the window.
      const box = (await toolbar(app).boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    });
  }

  await test.step('at 700px Bold works from the toolbar and from the selection bubble', async () => {
    await openNarrow(app, 700);
    const editor = activeEditor(app);
    await selectAll(app);
    await toolbarBold(app).click();
    await expect(editor.locator('strong')).toHaveText('Narrow window body');

    await selectAll(app);
    await expect(bubbleBold(app)).toBeVisible();
    await bubbleBold(app).click();
    await expect(editor.locator('strong')).toHaveCount(0);
  });

  await test.step('at 420px a tool in the More menu works', async () => {
    await openNarrow(app, 420);
    await more(app).click();
    await app.getByTitle('Heading 1').click();
    await expect(activeEditor(app).locator('h1')).toHaveText('Narrow window body');
  });
});

test('narrow window: focus mode hides the toolbar but keeps the selection bubble', async ({ app }) => {
  await createWideNote(app, `Narrow focus ${Date.now()}`, 'Quiet narrow body');

  for (const width of [800, 500]) {
    await openNarrow(app, width);
    await expect(toolbar(app)).toBeVisible();
    await screenshotInBothThemes(app, (theme) => `narrow-${width}-${theme}.png`);

    await app.keyboard.press('ControlOrMeta+Shift+KeyF');
    await expect(app.getByRole('button', { name: /Exit Focus/ })).toBeVisible();
    await expect(toolbar(app)).toBeHidden();

    // The bubble still shows on a selection, and a shortcut still formats it.
    await selectAll(app);
    await expect(bubbleBold(app)).toBeVisible();
    await app.keyboard.press('ControlOrMeta+b');
    await expect(activeEditor(app).locator('strong')).toHaveText('Quiet narrow body');
    await screenshotInBothThemes(app, (theme) => `narrow-${width}-focus-${theme}.png`);

    // Esc is not used here: ProseMirror swallows it while the editor has focus, so only the pill exits.
    await app.getByRole('button', { name: /Exit Focus/ }).click();
    await expect(toolbar(app)).toBeVisible();
    await selectAll(app);
    await app.keyboard.press('ControlOrMeta+b');
    await expect(activeEditor(app).locator('strong')).toHaveCount(0);
  }
});

// A word at the left edge, middle and right end of the paragraph's lines. The bubble is centred on
// the selection, so the edges are where it used to run off the window (#1398).
async function selectWordAt(page: Page, where: 'left' | 'middle' | 'right'): Promise<void> {
  await activeEditor(page).locator('p').first().evaluate((p, which) => {
    const words: { range: Range; left: number; right: number }[] = [];
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      for (const m of node.data.matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, m.index!);
        range.setEnd(node, m.index! + m[0].length);
        const rect = range.getBoundingClientRect();
        words.push({ range, left: rect.left, right: rect.right });
      }
    }
    const mid = (Math.min(...words.map((w) => w.left)) + Math.max(...words.map((w) => w.right))) / 2;
    const pick =
      which === 'left'
        ? words.reduce((a, b) => (b.left < a.left ? b : a))
        : which === 'right'
          ? words.reduce((a, b) => (b.right > a.right ? b : a))
          : words.reduce((a, b) => (Math.abs((b.left + b.right) / 2 - mid) < Math.abs((a.left + a.right) / 2 - mid) ? b : a));
    getSelection()!.setBaseAndExtent(pick.range.startContainer, pick.range.startOffset, pick.range.endContainer, pick.range.endOffset);
  }, where);
}

test('narrow window: the selection bubble stays inside the window at every edge', async ({ app }) => {
  const body = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  await createWideNote(app, `Bubble clamp ${Date.now()}`, body);

  for (const width of [800, 500]) {
    for (const focus of [false, true]) {
      await openNarrow(app, width);
      if (focus) {
        await app.keyboard.press('ControlOrMeta+Shift+KeyF');
        await expect(app.getByRole('button', { name: /Exit Focus/ })).toBeVisible();
      }
      for (const where of ['left', 'middle', 'right'] as const) {
        await test.step(`${width}px${focus ? ' focus' : ''}: ${where}`, async () => {
          await activeEditor(app).click();
          await selectWordAt(app, where);
          await expect(bubbleBold(app)).toBeVisible();
          const bubble = bubbleBold(app).locator('..');
          // Every width: the whole bubble sits at least 8px inside the window.
          await expect(async () => {
            const box = (await bubble.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(8);
            expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
            expect(box.y).toBeGreaterThanOrEqual(8);
          }).toPass();
          if (where === 'left' || where === 'right') {
            await screenshotInBothThemes(app, (theme) => `bubble-${width}-${focus ? 'focus-' : ''}${where}-${theme}.png`);
          }
        });
      }
      if (focus) await app.getByRole('button', { name: /Exit Focus/ }).click();
    }
  }
});
