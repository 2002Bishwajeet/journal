import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import { makeSolidPng } from '../support/png';

// #582: replace an image in place, download it, zoom/pan it in the lightbox.
test('replace keeps attrs and undo restores; download names the file; lightbox zooms', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await createNote(app, { title: `Image actions ${Date.now()}`, body: 'Image below.' });

  await activeEditor(app).evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/html', '<img src="/pwa-512x512.png" alt="Journal logo" width="240" data-align="left">');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const img = activeEditor(app).locator('img[alt="Journal logo"]');
  await expect(img).toBeVisible();
  await img.click();

  // Replace
  const chooser = app.waitForEvent('filechooser');
  await app.getByRole('button', { name: 'Replace image' }).click();
  await (await chooser).setFiles({ name: 'new.png', mimeType: 'image/png', buffer: makeSolidPng(800, 600, [200, 40, 40]) });
  await expect(img).toHaveAttribute('src', /^blob:/);
  await expect(img).toHaveAttribute('alt', 'Journal logo');
  await expect(img.locator('xpath=ancestor::div[contains(@class,"group")][1]')).toHaveCSS('float', 'left');
  await expect(img).toHaveCSS('width', '240px');
  await app.screenshot({ path: test.info().outputPath('replaced-light-1280.png') });

  await activeEditor(app).press('ControlOrMeta+z');
  await expect(img).toHaveAttribute('src', '/pwa-512x512.png');

  // Download
  await img.click();
  const download = app.waitForEvent('download');
  await app.getByRole('button', { name: 'Download image' }).click();
  expect((await download).suggestedFilename()).toBe('journal-logo.png');

  // Lightbox zoom + pan
  await img.dblclick();
  const dialog = app.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const zoom = dialog.getByTestId('lightbox-zoom');
  const scale = async () =>
    zoom.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  expect(await scale()).toBe(1);

  const box = (await dialog.boundingBox())!;
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 12; i++) await app.mouse.wheel(0, -200);
  await expect.poll(scale).toBeGreaterThanOrEqual(4);

  const before = await zoom.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).e);
  await app.mouse.down();
  await app.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
  await app.mouse.up();
  await expect.poll(() => zoom.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).e)).toBeGreaterThan(before + 40);
  await app.screenshot({ path: test.info().outputPath('lightbox-zoomed-light-1280.png') });

  await app.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(scale).toBe(1);

  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
