import { test, expect } from '../fixtures';
import { activeEditor, createNote, reloadNote, waitForNoteSaved, screenshotInBothThemes } from '../support/actions';

// #583: alt text shows centred under an image by default; a caption replaces it;
// "Hide caption" removes it. Edits survive a reload.
test('image caption: alt shows, caption overrides, hide, reload', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await createNote(app, { title: `Caption ${Date.now()}`, body: 'Image below.' });

  await activeEditor(app).evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/html', '<img src="/pwa-512x512.png" alt="Journal logo" width="240">');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const img = activeEditor(app).locator('img[alt="Journal logo"]');
  await expect(img).toBeVisible();
  const caption = activeEditor(app).getByTestId('image-caption');

  // Alt text is the caption by default, centred
  await expect(caption).toHaveText('Journal logo');
  await expect(caption).toHaveCSS('text-align', 'center');
  await screenshotInBothThemes(app, (colorScheme) => `caption-alt-${colorScheme}-1280.png`);

  // A caption replaces it
  await img.click();
  await app.getByRole('button', { name: 'Caption', exact: true }).click();
  await app.getByRole('textbox', { name: 'Caption text' }).fill('Our new logo');
  await app.keyboard.press('Enter');
  await expect(caption).toHaveText('Our new logo');
  await app.keyboard.press('Escape');
  await expect(app.getByRole('textbox', { name: 'Caption text' })).toHaveCount(0);
  await screenshotInBothThemes(app, (colorScheme) => `caption-custom-${colorScheme}-1280.png`);

  // Survives a reload
  await waitForNoteSaved(app);
  await reloadNote(app);
  await expect(activeEditor(app).getByTestId('image-caption')).toHaveText('Our new logo');

  // Hide
  await activeEditor(app).locator('img[alt="Journal logo"]').click();
  await app.getByRole('button', { name: 'Caption', exact: true }).click();
  await app.getByRole('button', { name: 'Hide caption' }).click();
  await expect(activeEditor(app).getByTestId('image-caption')).toHaveCount(0);
  // Closing the popover (blur) must not bring the caption back
  await app.keyboard.press('Escape');
  await expect(app.getByRole('textbox', { name: 'Caption text' })).toHaveCount(0);
  await app.mouse.click(5, 400);
  await expect(activeEditor(app).getByTestId('image-caption')).toHaveCount(0);
  await screenshotInBothThemes(app, (colorScheme) => `caption-hidden-${colorScheme}-1280.png`);

  // ...and stays hidden after a reload
  await waitForNoteSaved(app);
  await reloadNote(app);
  await expect(activeEditor(app).locator('img[alt="Journal logo"]')).toBeVisible();
  await expect(activeEditor(app).getByTestId('image-caption')).toHaveCount(0);
});
