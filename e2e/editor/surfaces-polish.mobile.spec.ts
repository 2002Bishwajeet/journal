import type { CDPSession, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, foldersNav, inBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { withMobilePage } from '../support/mobile';

// #833: the note screen, its sheets, the pickers, the image viewer and the tab bar as one
// designed iPhone app. Mostly evidence: every surface at 390x844 and 430x932 in light and dark,
// with a 59 px notch and a 34 px home indicator. It also checks that a zoomed image hides the
// viewer's bars, that reduced motion runs no sheet or bar-title animation, and that nothing
// scrolls sideways at 375 px. The safe-area override is CDP, so this runs in Chromium only.

const SIZES = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const PROFILE = { width: 393, height: 852 };

const more = (page: Page) => page.getByRole('button', { name: 'More', exact: true });
const toolbar = (page: Page) => page.locator('[data-mobile-toolbar]');

async function notch(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34 } });
  return cdp;
}

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

/** Every size in both themes; back to light at the 393 px profile afterwards. */
async function shots(page: Page, what: string) {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await inBothThemes(page, async (theme) => {
      await settle(page);
      await page.screenshot({ path: test.info().outputPath(`${what}-${theme}-${size.width}x${size.height}.png`) });
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize(PROFILE);
  await settle(page);
}

/** A note in Main with a long body, an image and the keyboard put away. */
async function longNote(page: Page, title: string) {
  await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
  await page.getByRole('button', { name: 'New note', exact: true }).tap();
  await expect(activeTitleInput(page)).toBeVisible();
  await activeTitleInput(page).fill(title);
  await activeEditor(page).tap();
  await page.keyboard.insertText(
    Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of a note long enough to scroll under the header.`).join('\n'),
  );
  // A plain same-origin image, pasted as HTML so it skips the upload pipeline.
  await activeEditor(page).evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/html', '<img src="/pwa-512x512.png" alt="Journal logo">');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(activeEditor(page).locator('img[alt="Journal logo"]')).toBeVisible();
}

const scroller = (page: Page) => activeEditor(page).locator('xpath=ancestor::*[contains(@class,"overflow-y-auto")][1]');

async function closeWithBack(page: Page, sheet: Locator) {
  await page.goBack();
  await expect(sheet).toBeHidden();
}

test('the note screen, its sheets, the pickers, the image viewer and the tab bar in both themes', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CDP safe-area emulation is Chromium only');
  test.setTimeout(240_000);
  await withMobilePage(browser, async (page) => {
    await notch(page);
    await assertTestOrigin(page);
    await page.evaluate(() => window.__journalE2E!.seedPendingSync());

    // Home: the folder list with the tab bar and the New note button.
    await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeVisible();
    await shots(page, 'home-tab-bar');

    const title = `Polish note ${Date.now()}`;
    await longNote(page, title);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await scroller(page).evaluate((el) => { el.scrollTop = 0; });
    await shots(page, 'note-top');

    await scroller(page).evaluate((el) => { el.scrollTop = 480; });
    await expect(page.locator('span[aria-hidden="false"]').filter({ hasText: title })).toHaveCSS('opacity', '1');
    await shots(page, 'note-scrolled');

    // The More action sheet, then Move to folder from it.
    await more(page).tap();
    const actions = page.getByRole('dialog', { name: title, exact: true });
    await expect(actions).toBeVisible();
    await shots(page, 'note-actions-sheet');
    await actions.getByRole('menuitem', { name: 'Move to folder…' }).tap();
    const move = page.getByRole('dialog', { name: /Move/ });
    await expect(move).toBeVisible();
    await shots(page, 'move-sheet');
    await closeWithBack(page, move);

    // The sync sheet from the header's sync icon.
    await page.locator('button[aria-label="Sync status"]:visible').first().tap();
    const sync = page.getByRole('dialog', { name: 'Sync status' });
    await expect(sync).toBeVisible();
    await shots(page, 'sync-sheet');
    await closeWithBack(page, sync);

    // The link and table pickers from the keyboard toolbar.
    await activeEditor(page).locator('p').first().tap();
    await expect(toolbar(page)).toBeVisible();
    await toolbar(page).getByTitle('Add Link').tap();
    const link = page.getByRole('dialog', { name: 'Link' });
    await expect(link).toBeVisible();
    await shots(page, 'link-sheet');
    await closeWithBack(page, link);

    await toolbar(page).getByTitle('Insert Table').tap();
    const table = page.getByRole('dialog', { name: 'Insert table' });
    await expect(table).toBeVisible();
    await shots(page, 'table-sheet');
    await closeWithBack(page, table);

    // The image viewer: at fit, then zoomed in.
    const img = activeEditor(page).locator('img[alt="Journal logo"]');
    await img.scrollIntoViewIfNeeded();
    await img.tap();
    await img.tap();
    const viewer = page.getByRole('dialog', { name: 'Journal logo' });
    await expect(viewer).toBeVisible();
    await shots(page, 'image-viewer');

    // Wheel zoom: a mouse double-click's first click lands on the captured stage and closes it.
    const stage = (await viewer.getByTestId('lightbox-zoom').boundingBox())!;
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.wheel(0, -300);
    await expect
      .poll(() => viewer.getByTestId('lightbox-zoom').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
      .toBeGreaterThan(1);
    await shots(page, 'image-viewer-zoomed');
    // Zoomed in, the bar and the caption fade out and take no taps; back at fit they return.
    const close = viewer.getByRole('button', { name: 'Close' });
    const barOpacity = () => close.locator('xpath=../..').evaluate((el) => getComputedStyle(el).opacity);
    await expect.poll(barOpacity).toBe('0');
    expect(await close.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    await page.mouse.wheel(0, 3000);
    await expect.poll(barOpacity).toBe('1');
    await close.tap();
    await expect(viewer).toBeHidden();
  });
});

test('with reduced motion no sheet or bar-title animation runs, and nothing scrolls sideways at 375 px', async ({
  browser,
}) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 375, height: 812 });
    const noSideScroll = async () =>
      expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(375);
    await noSideScroll();

    const title = `Reduced note ${Date.now()}`;
    await longNote(page, title);
    await noSideScroll();

    // The bar title appears at once.
    await scroller(page).evaluate((el) => { el.scrollTop = 480; });
    const barTitle = page.locator('span[aria-hidden="false"]').filter({ hasText: title });
    await expect(barTitle).toHaveCSS('opacity', '1');
    expect(parseFloat(await barTitle.evaluate((el) => getComputedStyle(el).transitionDuration))).toBeLessThanOrEqual(0.001);

    // The action sheet and its backdrop do not slide or fade.
    await more(page).tap();
    const actions = page.getByRole('dialog', { name: title, exact: true });
    await expect(actions).toBeVisible();
    for (const slot of ['sheet-content', 'dialog-overlay']) {
      const duration = await page
        .locator(`[data-slot="${slot}"]`)
        .last()
        .evaluate((el) => getComputedStyle(el).animationDuration);
      expect(parseFloat(duration), slot).toBeLessThanOrEqual(0.001);
    }
    await noSideScroll();
    await actions.getByRole('button', { name: 'Cancel' }).tap();
    await expect(actions).toBeHidden();
  });
});
