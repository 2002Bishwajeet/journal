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

// Screenshot evidence for the PR (#394). Written to test-results/ via outputPath.
const SHOT_BODY =
  'The morning light came through the window and settled on the desk, where a half-finished cup of tea had gone cold. I wrote down everything I could remember about the walk to the station, the smell of rain on the pavement, and the way the street lamps flickered on one by one.\n' +
  'Later that evening I reread the pages and noticed how much of the day had already blurred together. Small details like these are the reason I keep a journal at all, so that a quiet Tuesday does not disappear without a trace.';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`screenshots: appearance and editor typography (${colorScheme})`, async ({ app }) => {
    test.setTimeout(90_000);
    await app.setViewportSize({ width: 1920, height: 1080 });
    await app.emulateMedia({ colorScheme });
    const shot = (name: string) => app.screenshot({ path: test.info().outputPath(name) });

    await createNote(app, { title: 'A quiet Tuesday', body: SHOT_BODY });
    const pick = async (font: string, width: string) => {
      const d = await openAppearance(app);
      await d.getByRole('radiogroup', { name: 'Editor font' }).getByText(font, { exact: true }).click();
      await d.getByRole('radiogroup', { name: 'Editor width' }).getByText(width, { exact: true }).click();
      await closeSettings(app);
    };

    const dialog = await openAppearance(app);
    await expect(dialog.getByRole('radiogroup', { name: 'Editor font' })).toBeVisible();
    await expect(dialog.getByRole('radiogroup', { name: 'Editor width' })).toBeVisible();
    await shot(`appearance-section-${colorScheme}.png`);
    await closeSettings(app);
    await shot(`editor-default-${colorScheme}.png`);

    await pick('Serif', 'Narrow');
    await expect.poll(() => activeEditor(app).evaluate(fontOf)).toMatch(/Georgia/);
    await shot(`editor-serif-narrow-${colorScheme}.png`);

    if (colorScheme === 'light') {
      await pick('Mono', 'Full');
      await expect.poll(() => activeEditor(app).evaluate(fontOf)).toMatch(/mono/i);
      await shot('editor-mono-full-light.png');
    }
  });
}
