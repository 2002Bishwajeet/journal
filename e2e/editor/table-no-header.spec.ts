import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// #446: a table inserted in the editor has no header row (no th cells).

test('table picker inserts a table with no header row', async ({ app }) => {
  await createNote(app, { title: `Table picker ${Date.now()}`, body: 'Before' });
  await app.getByTitle('Insert Table').click();
  await app.getByRole('button', { name: '2 by 3 table' }).click();

  const editor = activeEditor(app);
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('table tr')).toHaveCount(2);
  await expect(editor.locator('table td')).toHaveCount(6);
  await expect(editor.locator('table th')).toHaveCount(0);
});

test('/table slash command inserts a table with no header row', async ({ app }) => {
  await createNote(app, { title: `Table slash ${Date.now()}`, body: '/table' });
  await app.keyboard.press('Enter');

  const editor = activeEditor(app);
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('table td').first()).toBeVisible();
  await expect(editor.locator('table th')).toHaveCount(0);
});
