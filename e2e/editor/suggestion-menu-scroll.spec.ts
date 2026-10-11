import { test, expect } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';
import type { Locator, Page } from '@playwright/test';

// #579: the slash, emoji and note-link menus keep the highlighted item visible
// while navigating past the visible area (ArrowDown, wrap-around, ArrowUp).

async function expectHighlightedInside(menuItems: Locator) {
  const item = menuItems.locator('xpath=self::*[contains(concat(" ", normalize-space(@class), " "), " bg-accent ")]');
  const menu = menuItems.first().locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
  await expect(item).toHaveCount(1);
  await expect
    .poll(async () => {
      const [i, m] = await Promise.all([item.boundingBox(), menu.boundingBox()]);
      if (!i || !m) return false;
      return i.y >= m.y - 1 && i.y + i.height <= m.y + m.height + 1;
    })
    .toBe(true);
}

async function walkMenu(page: Page, steps: number) {
  const items = page.locator('[data-index]');
  await expect(items.first()).toBeVisible();
  const total = await items.count();
  expect(total).toBeGreaterThan(8);
  const highlighted = () => items.and(page.locator('.bg-accent'));
  // Down past the visible area, then wrap around to the top.
  for (let n = 0; n < Math.min(steps, total) + 2; n++) {
    await page.keyboard.press('ArrowDown');
    await expectHighlightedInside(highlighted());
  }
  // Up from the top wraps to the bottom, then keeps moving up.
  for (let n = 0; n < 4; n++) {
    await page.keyboard.press('ArrowUp');
    await expectHighlightedInside(highlighted());
  }
}

test('slash menu keeps the highlighted item visible', async ({ app }) => {
  await createNote(app, { title: `Slash scroll ${Date.now()}`, body: '/' });
  await walkMenu(app, 40);
});

test('emoji menu keeps the highlighted item visible', async ({ app }) => {
  await createNote(app, { title: `Emoji scroll ${Date.now()}`, body: ':sm' });
  await walkMenu(app, 40);
});

test('note-link menu keeps the highlighted item visible', async ({ app }) => {
  // Seeding notes through the UI is slow; 8 matches (the picker's limit) plus
  // the "create" row already overflow the menu.
  test.slow();
  const stamp = `Zq${Date.now()}`;
  for (let n = 0; n < 8; n++) {
    await createNote(app, { title: `${stamp} ${n}`, body: 'x' });
  }
  await createNote(app, { title: `Linker ${stamp}`, body: `[[${stamp}` });
  await walkMenu(app, 40);
  await expect(activeEditor(app)).toBeVisible();
});
