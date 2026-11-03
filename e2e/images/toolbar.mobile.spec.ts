import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, inBothThemes, selectFolder, typeInEditor } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #917: on a phone the image toolbar shows only while the image is selected, and it never
// covers the paragraph above. #937: it is one row below the image, so the image stays in
// view; the actions that do not fit are in an action sheet.

for (const width of [390, 375]) {
  test(`the image toolbar is one row below the selected image and covers neither it nor the text above at ${width}px`, async ({
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

      await expect(toolbar).toBeHidden();
      await img.tap();
      await expect(toolbar).toBeVisible();

      const bar = (await toolbar.boundingBox())!;
      // The text line only: the paragraph box may also hold the image.
      const text = await paragraph.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el.firstChild!);
        const r = range.getBoundingClientRect();
        return { y: r.y, height: r.height };
      });
      const image = (await img.boundingBox())!;
      // One row of 44 px buttons: shorter than two
      const buttons = await toolbar.getByRole('button').all();
      for (const button of buttons) {
        const box = (await button.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.y).toBe((await buttons[0].boundingBox())!.y);
      }
      expect(bar.height).toBeLessThan(2 * 44);
      expect(bar.y).toBeGreaterThanOrEqual(text.y + text.height);
      // Below the image: its top edge, and all of it, stays visible
      expect(bar.y).toBeGreaterThanOrEqual(image.y + image.height);
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(width);

      await inBothThemes(page, (theme) =>
        page.screenshot({ path: test.info().outputPath(`toolbar-${theme}-${width}.png`), animations: 'disabled' }),
      );

      // The rest of the actions are in a sheet
      await toolbar.getByRole('button', { name: 'Image actions' }).tap();
      const sheet = page.getByRole('menu', { name: 'Image actions' });
      await expect(sheet).toBeVisible();
      for (const name of ['Float left', 'Center', 'Float right', 'View full size', 'Replace image', 'Download image']) {
        await expect(sheet.getByRole(/^Float|^Center/.test(name) ? 'menuitemradio' : 'menuitem', { name })).toBeVisible();
      }
      await inBothThemes(page, (theme) =>
        page.screenshot({ path: test.info().outputPath(`sheet-${theme}-${width}.png`), animations: 'disabled' }),
      );
      // Closing the sheet leaves the image selected, so its toolbar stays
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).tap();
      await expect(sheet).toBeHidden();
      await expect(toolbar).toBeVisible();
      await toolbar.getByRole('button', { name: 'Image actions' }).tap();
      await sheet.getByRole('menuitemradio', { name: 'Center' }).tap();
      await expect(sheet).toBeHidden();
      await expect(toolbar).toBeVisible();
      await toolbar.getByRole('button', { name: 'Image actions' }).tap();
      await expect(sheet.getByRole('menuitemradio', { name: 'Center' })).toHaveAttribute('aria-checked', 'true');
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).tap();
      await expect(sheet).toBeHidden();

      await paragraph.tap({ position: { x: 20, y: 8 } });
      await expect(toolbar).toBeHidden();
    });
  });
}
