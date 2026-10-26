import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';

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
