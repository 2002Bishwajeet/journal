import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// While you type on a phone, the caret line stays at least 16px above the
// toolbar and the keyboard (#790). The keyboard is simulated two ways: a smaller
// viewport (the layout resizes, as on Android) or a shorter visualViewport
// (the layout stays, as on iOS).

const toolbarTop = async (page: Page) => (await page.locator('[data-mobile-toolbar]').boundingBox())!.y;

// Bottom of the caret line: the selection rect, or the empty paragraph's box.
const caretBottom = (page: Page) =>
  page.evaluate(() => {
    const range = window.getSelection()!.getRangeAt(0);
    const rect = range.getClientRects()[0];
    if (rect) return rect.bottom;
    const node = range.startContainer;
    return (node instanceof Element ? node : node.parentElement!).getBoundingClientRect().bottom;
  });

async function typeFiveLinesAboveToolbar(page: Page, simulateKeyboard: () => Promise<void>) {
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).tap();
  await page.getByRole('button', { name: 'New', exact: true }).tap();
  const editor = activeEditor(page);
  await editor.tap();
  for (let i = 1; i <= 30; i++) {
    await page.keyboard.insertText(`Paragraph ${i}`);
    await page.keyboard.press('Enter');
  }
  await simulateKeyboard();
  await expect(page.locator('[data-mobile-toolbar]')).toBeVisible();

  const clearance = async () => (await toolbarTop(page)) - (await caretBottom(page));
  for (let i = 1; i <= 5; i++) {
    await page.keyboard.insertText(`Extra line ${i}`);
    await expect.poll(clearance).toBeGreaterThanOrEqual(16);
    await page.keyboard.press('Enter');
    await expect.poll(clearance).toBeGreaterThanOrEqual(16);
  }
  await page.screenshot({ path: test.info().outputPath('caret-above-toolbar-393x516.png') });
}

test('the caret stays above the toolbar when the layout shrinks for the keyboard', async ({ browser }) => {
  await withMobilePage(browser, (page) =>
    typeFiveLinesAboveToolbar(page, () => page.setViewportSize({ width: 393, height: 516 })),
  );
});

test('the caret stays above the toolbar when only the visual viewport shrinks', async ({ browser }) => {
  await withMobilePage(browser, (page) =>
    typeFiveLinesAboveToolbar(page, async () => {
      await page.evaluate(() => {
        const viewport = window.visualViewport!;
        Object.defineProperty(viewport, 'height', { configurable: true, value: 516 });
        Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 0 });
        viewport.dispatchEvent(new Event('resize'));
      });
    }),
  );
});
