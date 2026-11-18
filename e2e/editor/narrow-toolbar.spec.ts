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

async function openNarrow(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await expect(activeEditor(page)).toBeVisible();
}

async function selectAll(page: Page): Promise<void> {
  await activeEditor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
}

test('narrow window: the toolbar compacts into More and the selection bubble shows', async ({ app }) => {
  await app.setViewportSize({ width: 1440, height: 900 });
  await createNote(app, { title: `Narrow ${Date.now()}`, body: 'Narrow window body' });
  await waitForNoteSaved(app);

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
  await app.setViewportSize({ width: 1440, height: 900 });
  await createNote(app, { title: `Narrow focus ${Date.now()}`, body: 'Quiet narrow body' });
  await waitForNoteSaved(app);

  for (const width of [800, 500]) {
    await openNarrow(app, width);
    await expect(toolbar(app)).toBeVisible();
    await screenshotInBothThemes(app, (theme) => `narrow-${width}-${theme}.png`);

    await app.keyboard.press('ControlOrMeta+Shift+KeyF');
    await expect(app.getByRole('button', { name: /Exit Focus/ })).toBeVisible();
    // The pill and toolbar peek for a moment on entering (#1391); select and format only once they are gone.
    await expect(app.getByRole('button', { name: /Exit Focus/ })).toBeHidden({ timeout: 8000 });
    await expect(toolbar(app)).toBeHidden();

    // The bubble still shows on a selection, and a shortcut still formats it.
    await selectAll(app);
    await expect(bubbleBold(app)).toBeVisible();
    await app.keyboard.press('ControlOrMeta+b');
    await expect(activeEditor(app).locator('strong')).toHaveText('Quiet narrow body');
    await screenshotInBothThemes(app, (theme) => `narrow-${width}-focus-${theme}.png`);

    // Esc leaves focus mode from the note (#1391).
    await app.keyboard.press('Escape');
    await expect(app.getByRole('button', { name: /Exit Focus/ })).toBeHidden();
    await expect(toolbar(app)).toBeVisible();
    await selectAll(app);
    await app.keyboard.press('ControlOrMeta+b');
    await expect(activeEditor(app).locator('strong')).toHaveCount(0);
  }
});
