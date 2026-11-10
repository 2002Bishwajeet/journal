import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, typeInEditor, waitForNoteSaved } from '../support/actions';

// #1057: undo and redo are local edits, so the note list preview (the search index) follows them.

test('undo and redo update the note list preview and persist', async ({ app }) => {
  const title = `Undo preview ${Date.now()}`;
  const row = app.getByTestId('note-row').filter({ hasText: title });

  await createNote(app, { title, body: 'first' });
  await typeInEditor(app, ' draft');
  await expect(row).toContainText('first draft');

  await app.keyboard.press('ControlOrMeta+z');
  await expect(activeEditor(app)).toHaveText('first');
  await expect(row).toContainText('first');
  await expect(row).not.toContainText('first draft');

  await app.keyboard.press('ControlOrMeta+Shift+z');
  await expect(activeEditor(app)).toHaveText('first draft');
  await expect(row).toContainText('first draft');

  await waitForNoteSaved(app);
  await app.reload();
  await waitForAppReady(app);
  await expect(activeEditor(app)).toHaveText('first draft');
  await expect(row).toContainText('first draft');
});
