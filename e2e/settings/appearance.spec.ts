import type { Locator, Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// Settings → Appearance: editor font and width apply immediately and survive a
// reload (#394).

async function openAppearance(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Appearance' }).click();
  return dialog;
}

async function closeSettings(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
}

const fontOf = (el: Element) => getComputedStyle(el).fontFamily;

test('editor font: Serif applies to the editor content and survives a reload', async ({ app }) => {
  await createNote(app, { title: `Font ${Date.now()}`, body: 'Some body text.' });
  const before = await activeEditor(app).evaluate(fontOf);

  let dialog = await openAppearance(app);
  await dialog.getByRole('radiogroup', { name: 'Editor font' }).getByText('Serif', { exact: true }).click();
  await closeSettings(app);
  await expect.poll(() => activeEditor(app).evaluate(fontOf)).toMatch(/Georgia/);
  expect(before).not.toMatch(/Georgia/);

  await app.reload();
  await waitForAppReady(app);
  await expect.poll(() => activeEditor(app).evaluate(fontOf)).toMatch(/Georgia/);

  dialog = await openAppearance(app);
  await expect(dialog.getByRole('radiogroup', { name: 'Editor font' }).getByRole('radio', { name: 'Serif' })).toBeChecked();
});

test('editor width: Narrow is narrower and Full wider than Default; sidebar unchanged', async ({ app }) => {
  // 1920px, not 1440: with both sidebars open the pane is ~944px at 1440, under
  // the 1024px Default cap, so Full could not be wider there.
  await app.setViewportSize({ width: 1920, height: 1080 });
  await createNote(app, { title: `Width ${Date.now()}`, body: 'Some body text.' });

  const sidebar = app.getByRole('navigation', { name: 'Folders' });
  const editorWidth = async () => (await activeEditor(app).boundingBox())!.width;
  const sidebarWidth = async () => (await sidebar.boundingBox())!.width;

  const defaultWidth = await editorWidth();
  const defaultSidebar = await sidebarWidth();

  const choose = async (name: string) => {
    const dialog = await openAppearance(app);
    await dialog.getByRole('radiogroup', { name: 'Editor width' }).getByText(name, { exact: true }).click();
    await closeSettings(app);
  };

  await choose('Narrow');
  await expect.poll(editorWidth).toBeLessThan(defaultWidth - 50);
  expect(await sidebarWidth()).toBe(defaultSidebar);

  await choose('Full');
  await expect.poll(editorWidth).toBeGreaterThan(defaultWidth + 50);
  expect(await sidebarWidth()).toBe(defaultSidebar);
});
