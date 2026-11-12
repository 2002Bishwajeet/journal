import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { activeEditor, activeTitleInput, createFolder, pastePlainText, selectFolder, waitForNoteSaved } from '../support/actions';

// iOS kills a backgrounded web view's content process, and the app loads the page's URL
// again (#1187). Or iOS ends the whole app, and the next launch loads `/`, which session
// restore moves on to the last note. Either way the note comes back scrolled where it was,
// and the page tells the native app it is back (window.__JOURNAL_RESTORED__) so it can drop
// the snapshot it shows meanwhile.

const scrollTop = (page: Page) =>
  page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-note-scroller]')).find((el) => el.clientHeight > 0)?.scrollTop ?? -1);

/** A long note scrolled to 1500 px, then the app goes to the background. Returns the note's path. */
async function scrolledNoteThenHidden(page: Page): Promise<string> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createFolder(page, 'Resume scroll');
  await selectFolder(page, 'Resume scroll');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(activeTitleInput(page)).toHaveValue('Untitled');
  await activeEditor(page).click();
  await pastePlainText(page, Array.from({ length: 120 }, (_, i) => `Line ${i + 1}`).join('\n\n'));
  await waitForNoteSaved(page);
  const note = new URL(page.url()).pathname;

  await page.evaluate(() => {
    const scroller = Array.from(document.querySelectorAll<HTMLElement>('[data-note-scroller]')).find((el) => el.clientHeight > 0)!;
    scroller.scrollTop = 1500;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  return note;
}

async function expectRestored(page: Page, note: string): Promise<void> {
  await waitForAppReady(page);
  await expect(page.locator('.ProseMirror:visible')).toContainText('Line 120');
  await expect.poll(() => page.evaluate(() => (window as { __JOURNAL_RESTORED__?: boolean }).__JOURNAL_RESTORED__)).toBe(true);
  expect(new URL(page.url()).pathname).toBe(note);
  expect(await scrollTop(page)).toBe(1500);
}

test('a note loaded again after the app was hidden comes back at the same scroll position', async ({ browser }) => {
  test.setTimeout(60_000);
  await withMobilePage(browser, async (page) => {
    const note = await scrolledNoteThenHidden(page);
    await page.reload();
    await expectRestored(page, note);
  });
});

test('a new launch after the app was hidden opens the last note at the same scroll position', async ({ browser }) => {
  test.setTimeout(60_000);
  await withMobilePage(browser, async (page) => {
    const note = await scrolledNoteThenHidden(page);
    await page.goto('/');
    await expectRestored(page, note);
  });
});
