import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// Zen (focus) mode: the exit pill's wrapper must not swallow clicks on the
// toolbar under it, the visible pill must not cover the toolbar, and the
// Settings → Appearance width applies as in normal mode (#578).

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

test('Zen: toolbar buttons at the top are clickable and the pill does not cover them', async ({ app }) => {
  await app.setViewportSize({ width: 1440, height: 900 });
  await createNote(app, { title: `Zen ${Date.now()}`, body: 'Zen body text' });
  await enterZen(app);
  await expect(exitPill(app)).toBeAttached();

  // The hit target at the toolbar's centre is the toolbar, not the exit wrapper.
  const hit = await bold(app).evaluate((btn) => {
    const row = btn.closest('.border-b')!;
    const r = row.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)!;
    return { inToolbar: row.contains(el), inExitWrapper: !!el.closest('.group\\/focus') };
  });
  expect(hit).toEqual({ inToolbar: true, inExitWrapper: false });

  // The pill, once revealed by hover, sits above the toolbar rather than on it.
  await exitPill(app).hover();
  await expect(exitPill(app)).toHaveCSS('opacity', '1');
  const pill = (await exitPill(app).boundingBox())!;
  const toolbarTop = (await bold(app).evaluate((btn) => btn.closest('.border-b')!.getBoundingClientRect().top));
  expect(pill.y + pill.height).toBeLessThanOrEqual(toolbarTop);

  // Bold and a heading button apply.
  const editor = activeEditor(app);
  await editor.click();
  await app.keyboard.press('ControlOrMeta+a');
  await bold(app).click();
  await expect(editor.locator('strong')).toHaveText('Zen body text');
  await app.getByTitle('Heading 1').click();
  await expect(editor.locator('h1')).toHaveText('Zen body text');

  // The pill exits Zen; Cmd+Shift+F toggles it back on and off.
  await exitPill(app).click();
  await expect(exitPill(app)).toHaveCount(0);
  await app.keyboard.press('ControlOrMeta+Shift+KeyF');
  await expect(exitPill(app)).toBeAttached();
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

for (const colorScheme of ['light', 'dark'] as const) {
  test(`screenshots: Zen mode (${colorScheme})`, async ({ app }) => {
    await app.setViewportSize({ width: 1440, height: 900 });
    await app.emulateMedia({ colorScheme });
    await createNote(app, {
      title: 'A quiet Tuesday',
      body: 'The morning light came through the window and settled on the desk, where a half-finished cup of tea had gone cold.',
    });
    await enterZen(app);
    await exitPill(app).hover();
    await expect(exitPill(app)).toHaveCSS('opacity', '1');
    await app.screenshot({ path: test.info().outputPath(`zen-${colorScheme}.png`) });
  });
}
