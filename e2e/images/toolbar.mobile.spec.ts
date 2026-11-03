import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, inBothThemes, selectFolder, typeInEditor } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #917: on a phone the image toolbar shows only while the image is selected, and it sits
// inside the image, so it never covers the paragraph above.

for (const width of [390, 375]) {
  test(`the image toolbar shows only on the selected image and does not cover the text above it at ${width}px`, async ({
    browser,
  }) => {
    await withMobilePage(browser, async (page: Page) => {
      await page.setViewportSize({ width, height: 852 });
      await selectFolder(page, 'Main');
      const before = page.url();
      await page.getByRole('button', { name: 'New note', exact: true }).click();
      await page.waitForURL((url) => url.href !== before);
      await expect(activeTitleInput(page)).toHaveValue('Untitled');
      await activeTitleInput(page).fill(`Toolbar ${Date.now()}`);
      await typeInEditor(page, 'Text above the image.');
      await activeEditor(page).evaluate((el) => {
        const data = new DataTransfer();
        data.setData('text/html', '<img src="/pwa-512x512.png" alt="Journal logo">');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      });
      const img = activeEditor(page).locator('img[alt="Journal logo"]');
      await expect(img).toBeVisible();

      const toolbar = page.getByRole('button', { name: 'Alt text' }).locator('xpath=ancestor::div[contains(@class,"bg-popover")][1]');
      const paragraph = activeEditor(page).locator('p', { hasText: 'Text above the image.' });

      await expect(toolbar).toHaveCSS('opacity', '0');
      await img.tap();
      await expect(toolbar).toHaveCSS('opacity', '1');

      const bar = (await toolbar.boundingBox())!;
      // The text line only: the paragraph box may also hold the image.
      const text = await paragraph.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el.firstChild!);
        const r = range.getBoundingClientRect();
        return { y: r.y, height: r.height };
      });
      const image = (await img.boundingBox())!;
      expect(bar.y).toBeGreaterThanOrEqual(text.y + text.height);
      expect(bar.y + bar.height).toBeLessThanOrEqual(image.y + image.height);
      expect(bar.x + bar.width).toBeLessThanOrEqual(width);

      await inBothThemes(page, (theme) =>
        page.screenshot({ path: test.info().outputPath(`toolbar-${theme}-${width}.png`), animations: 'disabled' }),
      );

      await paragraph.tap({ position: { x: 20, y: 8 } });
      await expect(toolbar).toHaveCSS('opacity', '0');
    });
  });
}
