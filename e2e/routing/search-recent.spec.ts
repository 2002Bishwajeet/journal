import { test, expect } from '../fixtures';
import { createNote, inBothThemes } from '../support/actions';

// Search lists the notes you opened and the queries you picked, and clears them (#820).

test('search shows recent notes and recent searches, and removes them', async ({ app }) => {
  await createNote(app, { title: 'Bravo plan', body: 'Second note' });
  await createNote(app, { title: 'Alpha plan', body: 'First note' });

  await app.keyboard.press('ControlOrMeta+k');
  const dialog = app.getByRole('dialog', { name: 'Search notes' });
  const input = dialog.getByPlaceholder('Search notes...');
  const rows = dialog.locator('[id^="search-result-"]');
  await expect(dialog.getByText('Recent', { exact: true })).toBeVisible();
  await expect(rows.nth(0)).toContainText('Alpha plan');
  await expect(rows.nth(1)).toContainText('Bravo plan');
  await inBothThemes(app, async (theme) => {
    await app.screenshot({ path: test.info().outputPath(`search-recent-${theme}-desktop.png`) });
  });

  await input.fill('Bravo');
  await expect(rows.first()).toContainText('Bravo plan');
  await app.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  await app.keyboard.press('ControlOrMeta+k');
  await expect(dialog.getByText('Recent searches')).toBeVisible();
  await dialog.getByRole('button', { name: 'Bravo', exact: true }).click();
  await expect(input).toHaveValue('Bravo');
  await expect(rows.first()).toContainText('Bravo plan');
  await input.fill('');

  const removes = dialog.getByRole('button', { name: 'Remove from recent' });
  await expect(removes).toHaveCount(3);
  await dialog.locator('div.relative').filter({ hasText: 'Alpha plan' }).getByRole('button', { name: 'Remove from recent' }).click();
  await expect(removes).toHaveCount(2);

  await dialog.getByRole('button', { name: 'Clear' }).click();
  await expect(removes).toHaveCount(0);
  await expect(dialog.getByText('Recent searches')).toBeHidden();
  await expect(dialog.getByText('Recent', { exact: true })).toBeHidden();
  await expect(rows).toHaveCount(2);
});
