import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// #536: a paragraph ending in an inline node keeps normal height after the
// layout switches between mobile and desktop.
test('paragraph ending in a footnote reference keeps its height across the breakpoint', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 900 });
  await createNote(app, { title: `Separator ${Date.now()}`, body: 'Alpha beta gamma' });

  await app.keyboard.type(' /footnote');
  await app.keyboard.press('Enter');
  await app.keyboard.type('A note');

  const before = (await activeEditor(app).locator('p').first().boundingBox())!.height;

  await app.setViewportSize({ width: 390, height: 844 });
  await app.setViewportSize({ width: 1280, height: 900 });

  await expect
    .poll(async () => (await activeEditor(app).locator('p').first().boundingBox())?.height ?? 0)
    .toBeLessThan(before + 10);
  const margin = await activeEditor(app).evaluate(() => {
    const img = document.querySelector('img.ProseMirror-separator');
    return img ? getComputedStyle(img).marginTop : '0px';
  });
  expect(margin).toBe('0px');
});
