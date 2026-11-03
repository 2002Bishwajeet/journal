import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { activeTitleInput, createFolder, selectFolder } from '../support/actions';

// Coming back to the installed app after it was in the background must not add history
// entries: iOS can reload a backgrounded page, or show it again from its back/forward cache.
// One Back must still leave the note.

const pathOf = (page: Page) => new URL(page.url()).pathname;
const historyLength = (page: Page) => page.evaluate(() => history.length);

async function openNote(page: Page) {
  await createFolder(page, 'Resume');
  await selectFolder(page, 'Resume');
  await expect(page.getByRole('heading', { name: 'Resume' })).toBeVisible();
  const folder = pathOf(page);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await expect.poll(() => pathOf(page)).not.toBe(folder);
  await expect(activeTitleInput(page)).toHaveValue('Untitled');
  return { folder, note: pathOf(page) };
}

async function resumeEvents(page: Page) {
  await page.evaluate(() => {
    const visibility = (state: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    for (let i = 0; i < 3; i++) {
      visibility('hidden');
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
      visibility('visible');
      window.dispatchEvent(new Event('focus'));
    }
  });
}

test('resume events and reloads on a note add no history entries; one Back leaves the note', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { folder, note } = await openNote(page);
    const before = await historyLength(page);

    await resumeEvents(page);
    for (let i = 0; i < 3; i++) {
      await page.reload();
      await waitForAppReady(page);
      await expect(activeTitleInput(page)).toBeVisible();
      await resumeEvents(page);
    }
    // Let anything a resume or a boot schedules run before measuring.
    await page.waitForTimeout(1_000);
    expect(pathOf(page)).toBe(note);
    expect(await historyLength(page)).toBe(before);

    await page.goBack();
    await expect.poll(() => pathOf(page)).toBe(folder);
  });
});

test('a back/forward cache restore on a note adds no history entries', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { folder, note } = await openNote(page);
    const before = await historyLength(page);

    // What Safari fires when it caches the page and shows it again; the app reloads then.
    for (let i = 0; i < 2; i++) {
      await Promise.all([
        page.waitForEvent('load'),
        page.evaluate(() => {
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
          window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        }),
      ]);
      await waitForAppReady(page);
      await expect(activeTitleInput(page)).toBeVisible();
    }
    await page.waitForTimeout(1_000);
    expect(pathOf(page)).toBe(note);
    expect(await historyLength(page)).toBe(before);

    await page.goBack();
    await expect.poll(() => pathOf(page)).toBe(folder);
  });
});

// Back to an entry of an earlier page loads the app again on that entry (iOS reloads a page it
// put away in the background, and the entries from before stay). The app must stay on such an
// entry: restoring the last note on it made Back land on the note again and again.
test('Back into entries of an earlier page walks them and does not return to the note', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { folder, note } = await openNote(page);
    // The last note must be saved, or there is nothing a boot could restore.
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('journal-session-state') ?? '{}').lastNoteId))
      .toBe(note.split('/')[2]);
    // A new page: the entries before it belong to the earlier one.
    await page.goto(folder);
    await waitForAppReady(page);

    for (const path of [note, folder, '/']) {
      await page.goBack();
      await expect.poll(() => pathOf(page)).toBe(path);
      await waitForAppReady(page);
    }
    // A new page loaded for the entry, as on the iPhone.
    expect(await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type)).toBe('back_forward');
    // Past the restore's delay: the home screen stays.
    await page.waitForTimeout(1_500);
    expect(pathOf(page)).toBe('/');
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
  });
});
