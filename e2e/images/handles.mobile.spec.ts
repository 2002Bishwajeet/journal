import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, inBothThemes, selectFolder, typeInEditor } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #927: on a phone the resize handles show only on the selected image.

test('the resize handles show only on the selected image at 390px', async ({ browser }) => {
  await withMobilePage(browser, async (page: Page) => {
    await page.setViewportSize({ width: 390, height: 852 });
    await selectFolder(page, 'Main');
    const before = page.url();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.waitForURL((url) => url.href !== before);
    await expect(activeTitleInput(page)).toHaveValue('Untitled');
    await activeTitleInput(page).fill(`Handles ${Date.now()}`);
    await typeInEditor(page, 'Text above the image.');
    await activeEditor(page).evaluate((el) => {
      const data = new DataTransfer();
      data.setData('text/html', '<img src="/pwa-512x512.png" alt="Journal logo">');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const img = activeEditor(page).locator('img[alt="Journal logo"]');
    await expect(img).toBeVisible();

    const handle = page.getByRole('button', { name: /^Resize image/ }).last();
    const paragraph = activeEditor(page).locator('p', { hasText: 'Text above the image.' });

    await expect(handle).toHaveCSS('opacity', '0');
    await img.tap();
    await expect(handle).toHaveCSS('opacity', '1');
    await inBothThemes(page, (theme) =>
      page.screenshot({ path: test.info().outputPath(`handles-${theme}-390.png`), animations: 'disabled' }),
    );

    const box = (await handle.boundingBox())!;
    const widthBefore = (await img.boundingBox())!.width;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 60, y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await img.boundingBox())!.width).not.toBe(widthBefore);

    await paragraph.tap({ position: { x: 20, y: 8 } });
    await expect(handle).toHaveCSS('opacity', '0');
  });
});
