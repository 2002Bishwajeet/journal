import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// Search narrows by tag:, folder: and both, completes a tag from the keyboard, and drops a chip's filter (#1230).

test('search filters by tag and folder, completes a tag, and removes a chip', async ({ app }) => {
  await assertTestOrigin(app);
  // Travel 1-3 in Travel and Work 1-3 in Work; Travel 3 and Work 3 have the tags "work" and "ideas".
  await app.evaluate(() => window.__journalE2E!.seedFolders([{ name: 'Travel', count: 3 }, { name: 'Work', count: 3 }]));

  await app.keyboard.press('ControlOrMeta+k');
  const dialog = app.getByRole('dialog', { name: 'Search notes' });
  const input = dialog.getByPlaceholder('Search notes...');
  const rows = dialog.locator('[id^="search-result-"]');
  // Note rows carry the seeded body as their preview; suggestion rows do not.
  const notes = rows.filter({ hasText: 'Body of' });
  const chip = (label: string) => dialog.getByRole('button', { name: `Remove filter ${label}` });

  await input.fill('tag:work');
  await expect(notes).toHaveCount(2);
  await expect(notes.filter({ hasText: 'Travel 3' })).toHaveCount(1);
  await expect(notes.filter({ hasText: 'Work 3' })).toHaveCount(1);
  await expect(chip('#work')).toBeVisible();

  await input.fill('folder:trav ');
  await expect(notes).toHaveCount(3);
  for (const title of ['Travel 1', 'Travel 2', 'Travel 3']) await expect(notes.filter({ hasText: title })).toHaveCount(1);
  await expect(chip('Travel')).toBeVisible();

  await input.fill('folder:trav tag:work ');
  await expect(notes).toHaveCount(1);
  await expect(notes.first()).toContainText('Travel 3');

  // Complete a tag from the suggestions with the keyboard only.
  await input.fill('');
  await input.pressSequentially('tag:id');
  await expect(rows.first()).toContainText('#ideas');
  await expect(rows.first()).toContainText('2');
  await app.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(input).toHaveValue('tag:ideas ');
  await expect(notes).toHaveCount(2);

  await input.press('End');
  await input.pressSequentially('folder:work ');
  await expect(notes).toHaveCount(1);
  await expect(notes.first()).toContainText('Work 3');
  await chip('Work').click();
  await expect(input).toHaveValue('tag:ideas');
  await expect(chip('Work')).toHaveCount(0);
  await expect(notes).toHaveCount(2);
});
