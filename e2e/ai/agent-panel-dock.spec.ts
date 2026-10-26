import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';

// From lg the assistant docks beside the note (#704). Between 1024 and ~1340px there is no room for
// the sidebar, the notes list, the note and the 360px panel, so the notes list (and below 1088px the
// sidebar) hides while the panel is open, and the note keeps at least 480px. Closing brings them back.

test('the docked assistant leaves the note at least 480px wide from 1024px up', async ({ app }) => {
  await app.setViewportSize({ width: 1440, height: 800 });
  await createNote(app, { title: 'Dock width', body: 'A paragraph that should keep a readable width.' });
  const list = app.locator('[data-pane="note-list"]');
  const sidebar = app.locator('[data-pane="sidebar"]');
  const editor = app.locator('#main-content');

  await app.getByRole('button', { name: 'Open assistant' }).click();
  const panel = app.getByRole('region', { name: 'Assistant' });
  await expect(panel).toBeVisible();

  for (const width of [1024, 1060, 1100, 1280, 1340, 1440]) {
    await app.setViewportSize({ width, height: 800 });
    await expect.poll(async () => (await editor.boundingBox())!.width, { message: `editor width at ${width}px` }).toBeGreaterThanOrEqual(480);
    // Nothing is covered: the note ends where the panel starts.
    const e = (await editor.boundingBox())!;
    expect(e.x + e.width).toBeLessThanOrEqual((await panel.boundingBox())!.x);
  }

  await app.setViewportSize({ width: 1024, height: 800 });
  await expect(list).toBeHidden();
  await expect(sidebar).toBeHidden();
  await app.setViewportSize({ width: 1280, height: 800 });
  await expect(list).toBeHidden();
  await expect(sidebar).toBeVisible();

  await panel.getByRole('button', { name: 'Close assistant' }).click();
  await expect(list).toBeVisible();
  await expect(sidebar).toBeVisible();
});
