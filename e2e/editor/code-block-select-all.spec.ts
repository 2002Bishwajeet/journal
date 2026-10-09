import { test, expect } from '../fixtures';
import { activeEditor, createNote, pastePlainText } from '../support/actions';

// Select All inside a code block selects only its code; pressing it again selects the note.
test('select all in a code block selects only the code', async ({ app }) => {
  await createNote(app, { title: `Select all ${Date.now()}`, body: 'Intro' });
  await app.keyboard.press('Enter');
  await pastePlainText(app, '```js\nconst a = 1;\nconst b = 2;\n```');

  await activeEditor(app).locator('pre code').getByText('const b').click();
  await app.keyboard.press('ControlOrMeta+A');
  await expect.poll(() => app.evaluate(() => window.getSelection()?.toString())).toBe('const a = 1;\nconst b = 2;');
  // Copy puts just the code on the clipboard.
  const copied = await app.evaluate(() => {
    let text = '';
    document.addEventListener('copy', (e) => { text = e.clipboardData?.getData('text/plain') ?? ''; }, { once: true });
    document.execCommand('copy');
    return text;
  });
  expect(copied).toBe('const a = 1;\nconst b = 2;');

  await app.keyboard.press('ControlOrMeta+A');
  await expect.poll(() => app.evaluate(() => window.getSelection()?.toString())).toContain('Intro');
});
