import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { withMobilePage } from '../support/mobile';

// iOS Safari shrinks only the visual viewport for the software keyboard, so a dialog
// centred in the window had its Cancel button under the keyboard (#783, seen in the
// iOS Safari job). Neither Playwright engine has a software keyboard, so this swaps in
// a visualViewport we can resize the way Safari does.

async function fakeVisualViewport(page: Page): Promise<void> {
  await assertTestOrigin(page);
  await page.evaluate(() => {
    const fake = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
  });
}

async function showKeyboard(page: Page, viewport: { offsetTop: number; height: number }): Promise<void> {
  await assertTestOrigin(page);
  await page.evaluate((v) => {
    Object.assign(window.visualViewport!, v);
    window.visualViewport!.dispatchEvent(new Event('resize'));
  }, viewport);
}

/** The dialog and its footer buttons lie inside the visible part of the page. */
async function expectAboveKeyboard(page: Page, visible: { offsetTop: number; height: number }) {
  const dialog = page.getByRole('dialog', { name: /folder/i });
  const bottom = visible.offsetTop + visible.height;
  for (const target of [dialog, dialog.getByRole('button', { name: 'Cancel' }), dialog.getByRole('button', { name: 'Create' })]) {
    await expect.poll(async () => {
      const box = (await target.boundingBox())!;
      return box.y >= visible.offsetTop && box.y + box.height <= bottom;
    }).toBe(true);
  }
}

test('with the folder name focused, the New folder buttons stay above the keyboard', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await fakeVisualViewport(page);
    await page.getByRole('button', { name: 'New folder' }).click();
    const dialog = page.getByRole('dialog', { name: /folder/i });
    await expect(dialog.getByPlaceholder('Folder Name')).toBeFocused();
    await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

    // An iPhone 15 keyboard with its suggestion bar covers about 336 px.
    const keyboard = { offsetTop: 0, height: 852 - 336 };
    await showKeyboard(page, keyboard);
    await expectAboveKeyboard(page, keyboard);
    await page.screenshot({ path: test.info().outputPath('new-folder-keyboard-393.png') });

    // Safari may also scroll the page up under the keyboard.
    const scrolled = { offsetTop: 120, height: 852 - 336 };
    await showKeyboard(page, scrolled);
    await expectAboveKeyboard(page, scrolled);

    // Keyboard down: the dialog is centred in the window again.
    await showKeyboard(page, { offsetTop: 0, height: 852 });
    await expect.poll(async () => {
      const box = (await dialog.boundingBox())!;
      return Math.round(box.y + box.height / 2);
    }).toBe(426);
  });
});
