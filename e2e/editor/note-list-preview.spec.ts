import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// #521: the note list preview shows prose, never the html of a live block that opens the note.

test('note starting with an html block previews its first paragraph', async ({ app }) => {
  const title = `Preview ${Date.now()}`;
  await createNote(app, { title, body: '```html <div id="cover">zebrafinch</div>' });

  // Leave the code block (ArrowDown at the end of the doc adds a paragraph), then write prose.
  await app.keyboard.press('ArrowDown');
  await app.keyboard.type('Day one in Lisbon');
  await expect(activeEditor(app)).toContainText('Day one in Lisbon');

  const row = app.getByRole('button').filter({ hasText: title }).first();
  await expect(row).toContainText('Day one in Lisbon');
  await expect(row).not.toContainText('<div');
});
