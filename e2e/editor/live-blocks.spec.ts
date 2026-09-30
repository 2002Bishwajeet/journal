import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, typeInEditor } from '../support/actions';

// #388: code blocks whose language is `mermaid` or `svg` get a Preview / Code toggle.

test('mermaid block: previews as an svg, toggles to code, and previews again after reload', async ({ app }) => {
  await createNote(app, { title: `Mermaid ${Date.now()}`, body: '```mermaid graph TD; A-->B' });

  const editor = activeEditor(app);
  // An empty block starts in Code, so the note was typed into the source.
  await expect(app.getByRole('button', { name: 'Code', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await app.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(editor.locator('[data-live-block-preview] svg')).toBeVisible();

  await app.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(editor.locator('[data-live-block-preview]')).toHaveCount(0);
  await expect(editor.locator('pre code')).toContainText('graph TD; A-->B');

  await app.reload();
  await waitForAppReady(app);

  // The block has content at mount, so it comes back in Preview.
  await expect(activeEditor(app).locator('[data-live-block-preview] svg')).toBeVisible();
});

test('svg block: previews through an img with a data URI', async ({ app }) => {
  await createNote(app, {
    title: `Svg ${Date.now()}`,
    body: '```svg <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10"/></svg>',
  });

  await app.getByRole('button', { name: 'Preview', exact: true }).click();
  const img = activeEditor(app).locator('[data-live-block-preview] img');
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(img).toHaveAttribute('alt', 'SVG preview');
});

test('js block: no preview toggle', async ({ app }) => {
  await createNote(app, { title: `Js ${Date.now()}`, body: '```js const a = 1' });

  await expect(activeEditor(app).locator('pre code')).toContainText('const a = 1');
  await expect(app.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
});

test('invalid mermaid: shows an error in the preview and the editor stays usable', async ({ app }) => {
  await createNote(app, { title: `Bad mermaid ${Date.now()}`, body: '```mermaid this is not a diagram' });

  await app.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(activeEditor(app).locator('[data-live-block-preview] [role="alert"]')).toBeVisible();

  // Back in Code, the source is still editable.
  await app.getByRole('button', { name: 'Code', exact: true }).click();
  const code = activeEditor(app).locator('pre code');
  await code.click();
  await app.keyboard.type(' edited');
  await expect(code).toContainText('this is not a diagram edited');
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`screenshot: mermaid and svg blocks in preview, ${colorScheme} theme`, async ({ app }) => {
    // The theme preference defaults to "system", which follows prefers-color-scheme.
    await app.emulateMedia({ colorScheme });
    // Tall enough that the svg block is not cut off in the screenshot.
    await app.setViewportSize({ width: 1280, height: 960 });
    await createNote(app, { title: `Shots ${colorScheme} ${Date.now()}`, body: '```mermaid graph TD; A-->B' });
    // Enter three times leaves the code block; then start the svg block.
    await app.keyboard.press('Enter');
    await app.keyboard.press('Enter');
    await app.keyboard.press('Enter');
    await typeInEditor(
      app,
      '```svg <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="30" fill="orange"/></svg>'
    );

    // Each block has its own Preview/Code pair: mermaid is first, svg second.
    await app.getByRole('button', { name: 'Preview', exact: true }).nth(0).click();
    await app.getByRole('button', { name: 'Preview', exact: true }).nth(1).click();
    const editor = activeEditor(app);
    await expect(editor.locator('[data-live-block-preview] svg')).toBeVisible();
    await expect(editor.locator('[data-live-block-preview] img')).toBeVisible();
    await expect(app.locator('html')).toHaveClass(new RegExp(colorScheme));

    await app.screenshot({ path: test.info().outputPath(`live-blocks-${colorScheme}.png`) });
  });
}
