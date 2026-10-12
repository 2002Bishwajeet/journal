import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, screenshotInBothThemes } from '../support/actions';

// Zen (focus) mode: an always-visible Exit button sits in the toolbar row (no
// hover-only pill, no gap above the toolbar), Esc exits, toolbar tools work, and
// the Settings → Appearance width applies as in normal mode (#578).

const enterZen = (page: Page) => page.getByTitle('Focus Mode (Cmd+Shift+F)').click();
const exitPill = (page: Page) => page.getByRole('button', { name: /Exit Focus/ });
const bold = (page: Page) => page.getByTitle('Bold (Cmd+B)');

async function chooseWidth(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Appearance' }).click();
  await dialog.getByRole('radiogroup', { name: 'Editor width' }).getByText(name, { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

test('Zen: Exit is visible in the toolbar row, Esc exits, and toolbar buttons work', async ({ app }) => {
  await app.setViewportSize({ width: 1440, height: 900 });
  await createNote(app, { title: `Zen ${Date.now()}`, body: 'Zen body text' });
  await enterZen(app);

  // Visible without hovering, in the same row as the toolbar, which starts at the top.
  await expect(exitPill(app)).toBeVisible();
  const row = await bold(app).evaluate((btn) => btn.closest('.border-b')!.parentElement!.getBoundingClientRect());
  const exit = (await exitPill(app).boundingBox())!;
  expect(row.top).toBeLessThanOrEqual(1);
  expect(exit.y).toBeGreaterThanOrEqual(row.top);
  expect(exit.y + exit.height).toBeLessThanOrEqual(row.bottom);

  // Bold and a heading button apply.
  const editor = activeEditor(app);
  await editor.click();
  await app.keyboard.press('ControlOrMeta+a');
  await bold(app).click();
  await expect(editor.locator('strong')).toHaveText('Zen body text');
  await app.getByTitle('Heading 1').click();
  await expect(editor.locator('h1')).toHaveText('Zen body text');

  // Exit button, Esc and Cmd+Shift+F all leave Zen.
  await exitPill(app).click();
  await expect(exitPill(app)).toHaveCount(0);
  await app.keyboard.press('ControlOrMeta+Shift+KeyF');
  await expect(exitPill(app)).toBeVisible();
  await app.keyboard.press('Escape');
  await expect(exitPill(app)).toHaveCount(0);
  await app.keyboard.press('ControlOrMeta+Shift+KeyF');
  await expect(exitPill(app)).toBeVisible();
  await app.keyboard.press('ControlOrMeta+Shift+KeyF');
  await expect(exitPill(app)).toHaveCount(0);
});

test('Zen: the editor width setting applies as in normal mode', async ({ app }) => {
  await app.setViewportSize({ width: 1920, height: 1080 });
  await createNote(app, { title: `Zen width ${Date.now()}`, body: 'Some body text.' });
  const editorWidth = async () => (await activeEditor(app).boundingBox())!.width;

  for (const name of ['Narrow', 'Default']) {
    await chooseWidth(app, name);
    const normal = await editorWidth();
    await enterZen(app);
    await expect.poll(editorWidth).toBe(normal);
    await exitPill(app).click();
  }

  // Full has no cap, so in Zen it fills the (now wider) pane like it fills the
  // pane in normal mode: the pane minus the column's own padding.
  await chooseWidth(app, 'Full');
  const fill = async () =>
    activeEditor(app).evaluate((el) => {
      const pane = el.closest('.overflow-y-auto')!.clientWidth;
      return pane - el.getBoundingClientRect().width;
    });
  const normalGap = await fill();
  const normalFull = await editorWidth();
  await enterZen(app);
  await expect.poll(editorWidth).toBeGreaterThan(normalFull);
  expect(await fill()).toBe(normalGap);
});

test('screenshots: Zen mode', async ({ app }) => {
  await app.setViewportSize({ width: 1440, height: 900 });
  await createNote(app, {
    title: 'A quiet Tuesday',
    body: 'The morning light came through the window and settled on the desk, where a half-finished cup of tea had gone cold.',
  });
  await enterZen(app);
  await expect(exitPill(app)).toBeVisible();
  await screenshotInBothThemes(app, (colorScheme) => `zen-${colorScheme}.png`);
});
