import { test, expect } from '../fixtures';
import { createNote, inBothThemes } from '../support/actions';

// Docked assistant leftovers (#840): with the panel open a toast sits left of the panel instead of over
// its message box, and the editor toolbar keeps every button inside the note's column.

for (const width of [1024, 1100, 1280]) {
  test(`a toast clears the message box and the toolbar fits at ${width}px`, async ({ app }) => {
    // The sidebar (and its Settings button) hides at the narrower widths, so the toast is raised at 1280px.
    await app.setViewportSize({ width: 1280, height: 800 });
    await createNote(app, { title: 'Leftovers', body: 'A paragraph.' });
    await app.getByRole('button', { name: 'Open assistant' }).click();
    const panel = app.getByRole('region', { name: 'Assistant' });
    await expect(panel).toBeVisible();

    await app.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await app.getByRole('button', { name: 'Settings' }).click();
    const dialog = app.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'About', exact: true }).click();
    await dialog.getByRole('button', { name: 'Copy' }).click();
    const toast = app.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await app.setViewportSize({ width, height: 800 });

    const input = (await panel.getByPlaceholder('Type a message or /help...').boundingBox())!;
    await expect.poll(async () => {
      const t = (await toast.boundingBox())!;
      return t.x + t.width;
    }).toBeLessThanOrEqual(input.x);
    await inBothThemes(app, async (theme) => {
      await app.screenshot({ path: test.info().outputPath(`panel-toast-${theme}-${width}.png`) });
    });
    await app.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Every toolbar button sits inside the note's column and can be clicked.
    const buttons = app.locator('#main-content div:has(> button[title^="Undo"])').first().getByRole('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(10);
    const column = (await app.locator('#main-content').boundingBox())!;
    for (let i = 0; i < count; i++) {
      const box = (await buttons.nth(i).boundingBox())!;
      expect(box.x, `button ${i} left edge`).toBeGreaterThanOrEqual(column.x);
      expect(box.x + box.width, `button ${i} right edge`).toBeLessThanOrEqual(column.x + column.width);
      await buttons.nth(i).click({ trial: true });
    }
  });
}
