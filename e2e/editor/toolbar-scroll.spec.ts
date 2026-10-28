import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';

// The desktop formatting toolbar stays one row in a narrow editor pane and
// scrolls sideways instead of wrapping; the AI button next to it stays put.

test('formatting toolbar stays one row and scrolls when the pane is narrow', async ({ app }) => {
  // The narrowest desktop layout: sidebar and note list leave the editor pane under the toolbar's width.
  await app.setViewportSize({ width: 1024, height: 768 });
  await createNote(app, { title: `Toolbar ${Date.now()}`, body: 'Toolbar body' });

  const toolbar = app.getByRole('toolbar', { name: 'Formatting' });
  await expect(toolbar).toBeVisible();
  await app.screenshot({ path: test.info().outputPath('toolbar-1024.png') });

  const bold = (await app.getByTitle('Bold (Cmd+B)').boundingBox())!;
  const box = (await toolbar.boundingBox())!;
  // One row: no taller than one button plus the toolbar's vertical padding.
  expect(box.height).toBeLessThan(bold.height * 2);

  // The overflow scrolls instead of wrapping.
  const scroll = await toolbar.evaluate((el) => ({ width: el.scrollWidth, client: el.clientWidth }));
  expect(scroll.width).toBeGreaterThan(scroll.client);
  await toolbar.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
  await expect(app.getByRole('button', { name: 'Table of contents' })).toBeInViewport();

  // The AI button sits beside the toolbar, not under it, and doesn't scroll with it.
  const ai = (await app.getByRole('button', { name: 'AI Actions' }).boundingBox())!;
  expect(ai.x).toBeGreaterThanOrEqual(box.x + box.width - 1);
  expect(ai.y).toBeLessThan(box.y + box.height);
  await app.screenshot({ path: test.info().outputPath('toolbar-1024-scrolled.png') });

  // A popover opened from a scrolled toolbar portals out, so the overflow doesn't clip it.
  await app.getByTitle('Add Link (Cmd+Shift+K)').click();
  const field = app.getByPlaceholder('https://example.com');
  await expect(field).toBeInViewport();
  expect((await field.boundingBox())!.y).toBeGreaterThan(box.y + box.height);
});
