import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, createNote, screenshotInBothThemes, waitForNoteSaved } from '../support/actions';

// Focus mode is full focus (#1391): in a window below the desktop breakpoint the Exit Focus pill shows
// for a moment on entering, then only when the mouse goes to the top edge. Typing and scrolling never
// bring it back. Esc exits wherever the caret is, but closes an open popup first.

const pill = (page: Page) => page.getByRole('button', { name: /Exit Focus/ });
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });
const enter = (page: Page) => page.keyboard.press('ControlOrMeta+Shift+KeyF');

/** The mouse to the top edge: a move there, so it also works when the mouse is already near it. */
async function reveal(page: Page): Promise<void> {
  await page.mouse.move(350, 400);
  await page.mouse.move(350, 0);
}

async function openNote(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await createNote(page, { title: `Focus exit ${Date.now()}`, body: 'Quiet body text' });
  await waitForNoteSaved(page);
  await page.setViewportSize({ width, height: 800 });
  await expect(activeEditor(page)).toBeVisible();
}

for (const width of [1440, 700]) {
  test(`Esc exits focus mode with the caret in the note at ${width}px, but closes a popup first`, async ({ app }) => {
    await openNote(app, width);
    await enter(app);
    await activeEditor(app).click();

    // The slash menu is closed by the first Esc; focus mode stays.
    await app.keyboard.press('Control+End');
    await app.keyboard.type(' /');
    const menu = app.locator('[data-index]').first();
    await expect(menu).toBeVisible();
    await app.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    if (width < 1024) await reveal(app);
    await expect(pill(app)).toBeVisible();

    // The Find bar is closed by the first Esc too.
    await app.keyboard.press('ControlOrMeta+f');
    await expect(app.getByRole('textbox', { name: 'Find in note' })).toBeFocused();
    await app.keyboard.press('Escape');
    await expect(app.getByRole('textbox', { name: 'Find in note' })).toBeHidden();
    if (width < 1024) await reveal(app);
    await expect(pill(app)).toBeVisible();

    // Nothing is open: Esc leaves focus mode from the note.
    await activeEditor(app).click();
    await app.keyboard.press('Escape');
    await expect(pill(app)).toBeHidden();
    // The tab bar's Focus Mode button only exists at desktop width; below it the toolbar is back.
    if (width < 1024) await expect(toolbar(app)).toBeVisible();
    else await expect(app.getByTitle('Focus Mode (Cmd+Shift+F)')).toBeVisible();
  });
}

test('narrow window: the pill shows on entering, then only at the top edge', async ({ app }) => {
  await openNote(app, 700);
  await enter(app);

  await test.step('it shows on entering, then hides', async () => {
    await expect(pill(app)).toBeVisible();
    await screenshotInBothThemes(app, (theme) => `narrow-700-focus-pill-shown-${theme}.png`, () => reveal(app));
    await expect(pill(app)).toBeHidden({ timeout: 8000 });
    await expect(toolbar(app)).toBeHidden();
    await screenshotInBothThemes(app, (theme) => `narrow-700-focus-pill-hidden-${theme}.png`);
  });

  await test.step('typing and scrolling in both directions keep it hidden', async () => {
    const editor = activeEditor(app);
    await editor.evaluate((el) => (el.style.minHeight = '3000px'));
    await editor.click();
    await app.keyboard.press('Control+End');
    await app.keyboard.type(' more words');
    const scroller = app.locator('[data-note-scroller]:visible');
    for (const top of [400, 0, 200, 0]) {
      await scroller.evaluate((el, y) => el.scrollTo({ top: y }), top);
      await app.mouse.wheel(0, top ? -50 : 50);
    }
    await app.waitForTimeout(500);
    await expect(pill(app)).toBeHidden();
    await expect(toolbar(app)).toBeHidden();
  });

  await test.step('the mouse at the top edge shows the pill and the toolbar, and they hide again', async () => {
    await reveal(app);
    await expect(pill(app)).toBeVisible();
    await expect(toolbar(app)).toBeVisible();

    // Neither covers the title or the note's text.
    const title = (await activeTitleInput(app).boundingBox())!;
    const bar = (await toolbar(app).boundingBox())!;
    const exit = (await pill(app).boundingBox())!;
    for (const box of [bar, exit]) expect(box.y + box.height).toBeLessThanOrEqual(title.y + 1);
    await screenshotInBothThemes(app, (theme) => `narrow-700-focus-chrome-revealed-${theme}.png`, () => reveal(app));

    await app.mouse.move(350, 400);
    await expect(pill(app)).toBeHidden({ timeout: 10000 });
    await expect(toolbar(app)).toBeHidden();
  });

  await test.step('the revealed pill exits focus mode', async () => {
    await reveal(app);
    await pill(app).click();
    await expect(pill(app)).toBeHidden();
    await expect(toolbar(app)).toBeVisible();
  });
});
