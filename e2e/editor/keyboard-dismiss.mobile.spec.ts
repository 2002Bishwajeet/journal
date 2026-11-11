import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, screenshotInBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// With the keyboard up there is no Done button in the iOS app: the toolbar ends with a
// Hide keyboard button, and a deliberate drag down on the note closes the keyboard too.

const toolbar = (page: Page) => page.locator('[data-mobile-toolbar]');
const editorFocused = (page: Page) => page.evaluate(() => !!document.activeElement?.closest('.ProseMirror'));

async function newNoteWithText(page: Page) {
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).tap();
  await page.getByRole('button', { name: 'New note', exact: true }).tap();
  await activeEditor(page).tap();
  for (let i = 1; i <= 12; i++) {
    await page.keyboard.insertText(`Line ${i}`);
    await page.keyboard.press('Enter');
  }
  await expect(toolbar(page)).toBeVisible();
}

// A one-finger drag from `from` by (dx, dy), as touch events on the element under the finger.
async function drag(page: Page, selector: string, dx: number, dy: number) {
  await page.evaluate(
    ({ selector, dx, dy }) => {
      const target = document.querySelector(selector)!;
      const box = target.getBoundingClientRect();
      const x = box.left + 20;
      const y = box.top + box.height / 2;
      const fire = (type: string, cx: number, cy: number) => {
        const touch = new Touch({ identifier: 1, target, clientX: cx, clientY: cy });
        const touches = type === 'touchend' ? [] : [touch];
        target.dispatchEvent(
          new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: [touch] }),
        );
      };
      fire('touchstart', x, y);
      for (let i = 1; i <= 8; i++) fire('touchmove', x + (dx * i) / 8, y + (dy * i) / 8);
      fire('touchend', x + dx, y + dy);
    },
    { selector, dx, dy },
  );
}

test('the Hide keyboard button closes the keyboard and the toolbar', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await newNoteWithText(page);
    const hide = toolbar(page).getByRole('button', { name: 'Hide keyboard' });
    await expect(hide).toBeVisible();
    // Pinned at the end of the toolbar, outside the row that scrolls, with a 44px+ target.
    const box = (await hide.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeGreaterThan(393 - 60);
    await screenshotInBothThemes(page, (theme) => `hide-keyboard-button-${theme}-393x852.png`, undefined, {
      clip: { x: 0, y: 852 - 140, width: 393, height: 140 },
    });

    await hide.tap();
    await expect(toolbar(page)).toBeHidden();
    expect(await editorFocused(page)).toBe(false);
  });
});

test('a drag down on the note closes the keyboard; small, upward and sideways drags do not', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await newNoteWithText(page);
    const line = '.ProseMirror p:nth-of-type(3)';

    await drag(page, line, 0, 30);
    await drag(page, line, 0, -150);
    await drag(page, line, 150, 30);
    await drag(page, '[data-mobile-toolbar]', 0, 150);
    await expect(toolbar(page)).toBeVisible();
    expect(await editorFocused(page)).toBe(true);

    await drag(page, line, 0, 150);
    await expect(toolbar(page)).toBeHidden();
    expect(await editorFocused(page)).toBe(false);
  });
});
