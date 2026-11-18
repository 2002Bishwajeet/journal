import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, createNote, screenshotInBothThemes } from '../support/actions';
import { withMobilePage, withTabletPage } from '../support/mobile';

// Focus mode is full focus on a touch device (#1391): the Exit Focus pill shows for a moment on
// entering, then only for a tap on a thin strip at the top. Typing and scrolling never bring it back,
// and when shown it sits in the hidden note header's band, clear of the title.

const pill = (page: Page) => page.getByRole('button', { name: /Exit Focus/ });
const noteHeader = (page: Page) => page.getByRole('button', { name: /^Back to/ });
const tapTopStrip = (page: Page) => page.touchscreen.tap(page.viewportSize()!.width / 2, 6);

// A tablet's header has no Back button (the note list is beside the note), so only a phone checks it.
async function focusRoundTrip(page: Page, size: string, hasBack: boolean): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Shift+KeyF');

  await test.step('it shows on entering, then hides along with the note header', async () => {
    await expect(pill(page)).toBeVisible();
    await screenshotInBothThemes(page, (theme) => `focus-pill-shown-${theme}-${size}.png`, () => tapTopStrip(page));
    await expect(pill(page)).toBeHidden({ timeout: 8000 });
    if (hasBack) await expect(noteHeader(page)).toBeHidden();
    await screenshotInBothThemes(page, (theme) => `focus-pill-hidden-${theme}-${size}.png`);
  });

  await test.step('typing and scrolling in both directions keep it hidden', async () => {
    const editor = activeEditor(page);
    await editor.evaluate((el) => (el.style.minHeight = '3000px'));
    await editor.tap();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' more words');
    const scroller = page.locator('[data-note-scroller]:visible');
    for (const top of [400, 0, 200, 0]) await scroller.evaluate((el, y) => el.scrollTo({ top: y }), top);
    await page.waitForTimeout(500);
    await expect(pill(page)).toBeHidden();
  });

  await test.step('a tap on the top strip shows it, clear of the title, and it hides again', async () => {
    await tapTopStrip(page);
    await expect(pill(page)).toBeVisible();
    const exit = (await pill(page).boundingBox())!;
    const title = (await activeTitleInput(page).boundingBox())!;
    expect(exit.y + exit.height).toBeLessThanOrEqual(title.y + 1);
    await expect(pill(page)).toBeHidden({ timeout: 10000 });
  });

  await test.step('tapping the revealed pill exits focus mode', async () => {
    await tapTopStrip(page);
    await pill(page).tap();
    await expect(pill(page)).toBeHidden();
    if (hasBack) await expect(noteHeader(page)).toBeVisible();
  });
}

test('a phone: the exit pill hides in focus mode and a tap on the top strip brings it back', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).tap();
    await page.getByRole('button', { name: 'New note', exact: true }).tap();
    await expect(activeEditor(page)).toBeVisible();
    await focusRoundTrip(page, '393x852', true);
  });
});

test('a tablet in portrait: the exit pill hides in focus mode and a tap on the top strip brings it back', async ({ browser }) => {
  // Landscape is a desktop width: make the note there, then turn the iPad upright.
  await withTabletPage(browser, { width: 1180, height: 820 }, async (page) => {
    await createNote(page, { title: `Tablet focus ${Date.now()}`, body: 'Touch tablet body' });
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect(activeEditor(page)).toBeVisible();
    await focusRoundTrip(page, '820x1180', false);
  });
});
