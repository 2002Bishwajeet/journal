import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// A drag past an end of the floating toolbar's row rubber-bands the buttons and stretches
// the capsule, then springs back. At 393px the row fits, so any sideways drag is past an end.

const row = (page: Page) => page.locator('[data-mobile-toolbar] .overflow-x-auto');

async function openToolbar(page: Page) {
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).tap();
  await page.getByRole('button', { name: 'New note', exact: true }).tap();
  await activeEditor(page).tap();
  await expect(row(page)).toBeVisible();
}

// One-finger drag on the row by dx, as touch events; `release` lifts the finger.
const drag = (page: Page, dx: number, release: boolean) =>
  row(page).evaluate(
    (el, { dx, release }) => {
      const box = el.getBoundingClientRect();
      const fire = (type: string, x: number) => {
        const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: box.top + 20 });
        const touches = type === 'touchend' ? [] : [touch];
        el.dispatchEvent(new TouchEvent(type, { bubbles: true, touches, targetTouches: touches, changedTouches: [touch] }));
      };
      const x = box.left + 40;
      fire('touchstart', x);
      for (let i = 1; i <= 6; i++) fire('touchmove', x + (dx * i) / 6);
      if (release) fire('touchend', x + dx);
    },
    { dx, release },
  );

const lift = (page: Page) =>
  row(page).evaluate((el) => {
    const touch = new Touch({ identifier: 1, target: el, clientX: 0, clientY: 0 });
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch] }));
  });

const transforms = (page: Page) =>
  row(page).evaluate((el) => [el.style.transform, (el.parentElement as HTMLElement).style.transform]);

test('a drag past the start rubber-bands and stretches the toolbar, then springs back', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await openToolbar(page);
    await drag(page, 80, false);
    const [rowTransform, capsuleTransform] = await transforms(page);
    const offset = Number(/translateX\(([\d.]+)px\)/.exec(rowTransform)?.[1]);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(80);
    expect(Number(/scaleX\(([\d.]+)\)/.exec(capsuleTransform)?.[1])).toBeGreaterThan(1);

    await lift(page);
    // It springs back with a transition, not a jump.
    expect(await row(page).evaluate((el) => el.style.transition)).toContain('linear(');
    await expect.poll(() => transforms(page)).toEqual(['', '']);
  });
});

test('with reduced motion the row just stops at its ends', async ({ browser }) => {
  await withMobilePage(
    browser,
    async (page) => {
      await openToolbar(page);
      await drag(page, 80, false);
      expect(await transforms(page)).toEqual(['', '']);
    },
    { reducedMotion: 'reduce' },
  );
});
