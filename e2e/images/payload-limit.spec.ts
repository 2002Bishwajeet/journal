import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import { makeSolidPng } from '../support/png';

// #876: Homebase refuses a file with more than 25 payloads (the note text takes one), so
// a note holds 24 images. Dropping more adds none past the limit and says why.

const PNG = makeSolidPng(200, 150, [143, 163, 173]).toString('base64');

test('dropping 26 images adds 24 and tells the user the note is full', async ({ reusedApp: app }) => {
  test.slow();
  await app.setViewportSize({ width: 1280, height: 800 });
  await createNote(app, { title: `Limit ${Date.now()}`, body: 'Photos below.' });

  const editor = activeEditor(app);
  const text = (await editor.getByText('Photos below.').boundingBox())!;
  const [x, y] = [text.x + text.width - 1, text.y + text.height / 2];
  await editor.evaluate((el, { base64, x, y }) => {
    const data = new DataTransfer();
    for (let i = 0; i < 26; i++) {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      data.items.add(new File([bytes], `p${i}.png`, { type: 'image/png' }));
    }
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, { base64: PNG, x, y });

  await expect(app.getByText(/at most 24 images|room for 24 more images/).first()).toBeVisible();
  await expect(editor.locator('img:not(.ProseMirror-separator)')).toHaveCount(24);

  // Full: one more is refused with the message, and nothing is added
  await editor.evaluate((el, { base64, x, y }) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'one-more.png', { type: 'image/png' }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, { base64: PNG, x, y });
  await expect(app.getByText('This note holds at most 24 images. Split it, or link a new note.').first()).toBeVisible();
  await expect(editor.locator('img:not(.ProseMirror-separator)')).toHaveCount(24);
  await app.screenshot({ path: test.info().outputPath('image-limit-1280.png') });
});
