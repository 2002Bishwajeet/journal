import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, pastePlainText, waitForNoteSaved } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #1045: on a phone, a frame whose page can scroll takes the touch, and the note stops scrolling.
// A block's page scrolls only when the app clamped its frame. Playwright has no touch scroll and
// no wheel in mobile WebKit, so the wheel checks run in Chromium; the overflow checks run in both.

const GROWS = [
  '<button id="more">More</button>',
  '<div id="extra" hidden style="height: 400px">Extra</div>',
  '<div style="height: 300px">Card</div>',
  "<script>document.getElementById('more').onclick = () => { document.getElementById('extra').hidden = false; };</script>",
].join('\n');

const TALL = '<div style="height: 2400px">A page taller than the cap</div>';

const PARAGRAPHS = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of a note long enough to scroll.`).join('\n\n');

const scroller = (page: Page) => activeEditor(page).locator('xpath=ancestor::*[contains(@class,"overflow-y-auto")][1]');

async function noteWithBlock(page: Page, source: string) {
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).tap();
  await page.getByRole('button', { name: 'New note', exact: true }).tap();
  await activeEditor(page).tap();
  // The note first, then the block in an empty paragraph above it: a paste right after the
  // block would land in its code.
  await pastePlainText(page, PARAGRAPHS);
  await expect(activeEditor(page).getByText('Paragraph 30 of')).toBeAttached();
  // Let the paste's save land before moving the caret: under load the caret was left in
  // paragraph 30, and the block was pasted into its text instead of above the note.
  await waitForNoteSaved(page);
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('Enter');
  await expect(activeEditor(page).locator('p').first()).toHaveText('');
  await page.keyboard.press('ArrowUp');
  await pastePlainText(page, '```html\n' + source + '\n```');
  const block = activeEditor(page).locator('[data-live-block="html"]');
  await expect(activeEditor(page).getByText('Paragraph 1 of')).toBeAttached();
  return { box: block.locator('[data-live-block-preview="html"]'), frame: block.frameLocator('iframe[title="HTML preview"]') };
}

test('html block: a block that fits never scrolls itself, also after it grows', async ({ browser, browserName }) => {
  await withMobilePage(browser, async (page) => {
    const { box, frame } = await noteWithBlock(page, GROWS);
    await expect(box).toHaveCSS('height', /^3\d\dpx$/);
    await frame.getByRole('button', { name: 'More' }).tap();
    await expect(frame.getByText('Extra')).toBeVisible();
    await expect(box).toHaveCSS('height', /^7\d\dpx$/);
    await expect(frame.locator('html')).toHaveCSS('overflow-y', 'hidden');
    if (browserName !== 'chromium') return;

    await scroller(page).evaluate((el) => {
      el.scrollTop = 0;
    });
    const area = (await box.boundingBox())!;
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    expect(await frame.locator('html').evaluate((el) => el.scrollTop)).toBe(0);
  });
});

test('html block: a block taller than the cap scrolls inside its frame', async ({ browser, browserName }) => {
  await withMobilePage(browser, async (page) => {
    const { box, frame } = await noteWithBlock(page, TALL);
    await expect(box).toHaveCSS('height', '1600px');
    await expect(frame.locator('html')).toHaveCSS('overflow-y', 'auto');
    if (browserName !== 'chromium') return;

    await box.scrollIntoViewIfNeeded();
    const area = (await box.boundingBox())!;
    await page.mouse.move(area.x + area.width / 2, Math.max(area.y, 0) + 200);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => frame.locator('html').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  });
});
