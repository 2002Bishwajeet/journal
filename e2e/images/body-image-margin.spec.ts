import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// #552: the image box clips, so the img's own margin pushed its bottom out of it.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`body image sits fully inside its box (${colorScheme})`, async ({ app }) => {
    await app.emulateMedia({ colorScheme });
    await app.setViewportSize({ width: 1280, height: 800 });
    await createNote(app, { title: `Margin ${Date.now()}`, body: 'Image below.' });

    await activeEditor(app).evaluate((el) => {
      const data = new DataTransfer();
      data.setData('text/html', '<img src="/pwa-512x512.png" alt="Journal logo">');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });

    const img = activeEditor(app).locator('img[alt="Journal logo"]');
    await expect(img).toBeVisible();
    const imgBox = (await img.boundingBox())!;
    const wrapperBox = (await img.locator('xpath=ancestor::div[contains(@class,"group")][1]').boundingBox())!;
    expect(imgBox.y + imgBox.height).toBeLessThanOrEqual(wrapperBox.y + wrapperBox.height + 0.5);
    expect(imgBox.y).toBeGreaterThanOrEqual(wrapperBox.y - 0.5);

    await app.screenshot({ path: test.info().outputPath(`body-image-${colorScheme}-1280.png`) });
  });
}
