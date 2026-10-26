import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// #182 follow-up: the lightbox fills the viewport (not capped at 32rem by the
// base dialog) and shows the alt text as a caption under the image.
test('lightbox fills the viewport and captions the image with its alt text', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await createNote(app, { title: `Lightbox ${Date.now()}`, body: 'Image below.' });

  // A plain same-origin image, pasted as HTML so it skips the upload pipeline.
  await activeEditor(app).evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/html', '<img src="/pwa-512x512.png" alt="Journal logo">');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });

  await activeEditor(app).locator('img[alt="Journal logo"]').dblclick();

  const dialog = app.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Journal logo', { exact: true })).toBeVisible();
  await expect.poll(async () => (await dialog.boundingBox())?.width).toBeGreaterThan(1200);

  // On a short window the dialog height cap (#783) keeps the image and caption on screen.
  await app.setViewportSize({ width: 1280, height: 400 });
  await expect.poll(async () => { const b = (await dialog.boundingBox())!; return b.y >= 0 && b.y + b.height <= 400; }).toBe(true);
  await expect(dialog.getByText('Journal logo', { exact: true })).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);

  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
