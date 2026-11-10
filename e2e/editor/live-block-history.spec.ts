import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, pastePlainText } from '../support/actions';

// #1044: a new document in an html block's frame must not add a history entry, or Back walks
// through the frame's pages before it leaves the note.

const block = (app: Page) => activeEditor(app).locator('[data-live-block="html"]');
const frame = (app: Page) => block(app).locator('iframe[title="HTML preview"]');

/** Replaces the block's source in one transaction, as a synced or MCP edit reaches the editor. */
async function replaceSource(app: Page, source: string) {
  await activeEditor(app).evaluate((dom, text) => {
    const { editor } = dom as unknown as { editor: import('@tiptap/core').Editor };
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'codeBlock') return true;
      editor.view.dispatch(editor.state.tr.insertText(text, pos + 1, pos + 1 + node.content.size));
      return false;
    });
  }, source);
}

test('html block: a new source or theme in its frame adds no history entry, and one Back leaves the note', async ({ app }) => {
  await createNote(app, { title: `Live block history ${Date.now()}`, body: 'Intro' });
  await app.keyboard.press('Enter');
  await pastePlainText(app, '```html\n<p id="out">one</p>\n```');
  await expect(frame(app).contentFrame().locator('#out')).toHaveText('one');

  const noteUrl = app.url();
  const length = await app.evaluate(() => history.length);

  for (const text of ['two', 'three']) {
    await replaceSource(app, `<p id="out">${text}</p>`);
    await expect(frame(app).contentFrame().locator('#out')).toHaveText(text);
  }
  const before = await frame(app).getAttribute('srcdoc');
  await app.evaluate(() => document.documentElement.classList.toggle('dark'));
  await expect(frame(app)).not.toHaveAttribute('srcdoc', before!);
  await expect(frame(app).contentFrame().locator('#out')).toHaveText('three');

  expect(await app.evaluate(() => history.length)).toBe(length);
  await app.goBack();
  await expect(app).not.toHaveURL(noteUrl);
});
