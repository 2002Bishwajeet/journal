import { test, expect } from '../fixtures';
import { createNote, inBothThemes } from '../support/actions';

// Desktop Search keeps its keyboard flow and floating card (#780 must not regress it).

test('Cmd+K opens search, arrows and Enter pick a note, Esc closes', async ({ app }) => {
  await createNote(app, { title: 'Yak shaving', body: 'Bald yak' });
  await createNote(app, { title: 'Yak herding', body: 'Many yaks' });

  await app.keyboard.press('ControlOrMeta+k');
  const dialog = app.getByRole('dialog', { name: 'Search notes' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThan(app.viewportSize()!.width);
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeHidden();

  await dialog.getByPlaceholder('Search notes...').fill('Yak');
  const results = dialog.locator('[id^="search-result-"]');
  await expect(results).toHaveCount(2);
  await expect(results.first()).toContainText('Main');
  await inBothThemes(app, async (theme) => {
    await app.screenshot({ path: test.info().outputPath(`search-results-${theme}-desktop.png`) });
  });

  // Typing another letter keeps the two rows mounted: no "Searching..." block between keystrokes.
  const handles = await results.elementHandles();
  await dialog.getByPlaceholder('Search notes...').pressSequentially(' ');
  await expect(dialog.getByText('Searching...')).toHaveCount(0);
  await expect(results).toHaveCount(2);
  expect(await Promise.all(handles.map((h) => h.evaluate((el) => el.isConnected)))).toEqual([true, true]);
  await dialog.getByPlaceholder('Search notes...').fill('Yak');
  await expect(results).toHaveCount(2);
  await app.keyboard.press('ArrowDown');
  await expect(results.nth(1)).toHaveClass(/bg-accent/);
  await results.nth(0).hover();
  await expect(results.nth(0)).toHaveClass(/bg-accent/);

  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await app.keyboard.press('ControlOrMeta+k');
  await dialog.getByPlaceholder('Search notes...').fill('Yak shaving');
  await expect(results.first()).toBeVisible();
  await app.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(app.locator('textarea[placeholder="Untitled"]:visible')).toHaveValue('Yak shaving');
});

test('a note moved to Trash is not listed in search', async ({ app }) => {
  const title = `Trashed yak ${Date.now()}`;
  await createNote(app, { title, body: 'Gone soon' });
  await app.getByTestId('note-row').filter({ hasText: title }).click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await app.getByRole('dialog', { name: 'Move to Trash?' }).getByRole('button', { name: 'Move to Trash' }).click();

  await app.keyboard.press('ControlOrMeta+k');
  const dialog = app.getByRole('dialog', { name: 'Search notes' });
  await dialog.getByPlaceholder('Search notes...').fill(title);
  await expect(dialog.getByText('No notes found')).toBeVisible();
});
