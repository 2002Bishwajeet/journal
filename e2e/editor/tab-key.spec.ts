import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// #841: Tab in a paragraph moves focus on (WCAG 2.1.2) instead of indenting the note;
// a list item still indents.
test('Tab in a paragraph leaves the editor without changing the note; in a list it indents', async ({ app }) => {
  await createNote(app, { title: `Tab ${Date.now()}`, body: 'Plain paragraph' });
  const editor = activeEditor(app);
  const before = await editor.innerHTML();

  await app.keyboard.press('Tab');
  await expect(editor).not.toBeFocused();
  expect(await editor.innerHTML()).toBe(before);

  await editor.click();
  await app.keyboard.press('Enter');
  await app.keyboard.type('- one');
  await app.keyboard.press('Enter');
  await app.keyboard.type('two');
  await app.keyboard.press('Tab');
  await expect(editor).toBeFocused();
  await expect(editor.locator('li li', { hasText: 'two' })).toBeVisible();
});
