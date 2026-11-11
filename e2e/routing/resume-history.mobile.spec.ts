import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { activeTitleInput, createFolder, selectFolder, waitForNoteSaved } from '../support/actions';

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
  // The tests reload the page; a reload before the flush to IndexedDB loses the new note.
  await waitForNoteSaved(page);
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
// put away in the background, and the entries from before stay). On the home entry the app
// restored the last note there, so Back landed on the note again and again. It must stay home.
test('Back into a home entry of an earlier page stays home and does not return to the note', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { note } = await openNote(page);
    const lastNoteId = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem('journal-session-state') ?? '{}').lastNoteId);
    await expect.poll(lastNoteId).toBe(note.split('/')[2]);

    // Home as a page of its own, with no last note for its launch to restore.
    await page.evaluate(() => localStorage.removeItem('journal-session-state'));
    await page.goto('/');
    await waitForAppReady(page);
    // The note as the next page: Back to home loads that page again, as on the iPhone.
    await page.goto(note);
    await waitForAppReady(page);
    await expect(activeTitleInput(page)).toBeVisible();
    // The last note must be saved, or there is nothing a boot could restore.
    await expect.poll(lastNoteId).toBe(note.split('/')[2]);

    // The resume: iOS reloads the backgrounded page.
    await page.reload();
    await waitForAppReady(page);
    await expect(activeTitleInput(page)).toBeVisible();

    await page.goBack();
    await expect.poll(() => pathOf(page)).toBe('/');
    await waitForAppReady(page);
    // A new page loaded for the home entry, not a same-page history step.
    const load = await page.evaluate(() => {
      const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      return { type: entry.type, path: new URL(entry.name).pathname };
    });
    expect(load).toEqual({ type: 'back_forward', path: '/' });
    // Past the restore's delay: the home screen stays.
    await page.waitForTimeout(1_500);
    expect(pathOf(page)).toBe('/');
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
  });
});
