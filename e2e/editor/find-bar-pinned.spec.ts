import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeTitleInput, createNote, pasteHtml, screenshotInBothThemes, waitForNoteSaved } from '../support/actions';

// The Find bar floats at the top of the visible note, wherever it is scrolled (#1419), and
// Cmd/Ctrl+F and +H open it from anywhere in the app.

const paragraphs = (n: number) =>
  Array.from({ length: n }, (_, i) => `<p>Filler paragraph number ${i + 1} with ordinary words${i % 10 === 0 ? ' zorbleflux' : ''}.</p>`).join('');

const findBox = (page: Page) => page.getByRole('textbox', { name: 'Find in note' });
const scroller = (page: Page) => page.locator('[data-note-scroller]:visible');

async function expectBarInView(page: Page) {
  const pane = (await scroller(page).boundingBox())!;
  const bar = (await page.getByRole('search').boundingBox())!;
  expect(bar.y).toBeGreaterThanOrEqual(pane.y - 1);
  expect(bar.y + bar.height).toBeLessThanOrEqual(pane.y + pane.height + 1);
  expect(bar.x).toBeGreaterThanOrEqual(pane.x - 1);
  expect(bar.x + bar.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
}

test('Find opens pinned in view at the bottom of a long note, and stays there', async ({ app }) => {
  await createNote(app, { title: 'Long note', body: 'start' });
  await pasteHtml(app, paragraphs(80));
  await waitForNoteSaved(app);

  await scroller(app).evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await app.keyboard.press('ControlOrMeta+f');
  await expect(findBox(app)).toBeFocused();
  await expectBarInView(app);

  await findBox(app).fill('zorbleflux');
  await expect(app.getByRole('search').getByText(/of 8/)).toBeVisible();
  await expectBarInView(app);

  await app.keyboard.press('Enter');
  await app.keyboard.press('Enter');
  await expectBarInView(app);
  // The current match is not under the bar (the match scrolls in a frame after the keypress).
  await expect.poll(async () => {
    const match = await app.locator('.search-highlight-current:visible').boundingBox();
    const bar = await app.getByRole('search').boundingBox();
    if (!match || !bar) return false;
    return match.y >= bar.y + bar.height || match.y + match.height <= bar.y || match.x + match.width <= bar.x;
  }).toBe(true);

  await scroller(app).evaluate((el) => el.scrollBy(0, -400));
  await expectBarInView(app);

  await screenshotInBothThemes(app, (theme) => `find-bar-pinned-${theme}-desktop.png`);
});

test('Cmd/Ctrl+F and +H open Find and Replace wherever focus is', async ({ app }) => {
  await createNote(app, { title: 'Find me', body: 'some text to find' });
  await waitForNoteSaved(app);

  const focusPlaces: Array<() => Promise<unknown>> = [
    () => activeTitleInput(app).focus(),
    () => app.getByText('Find me').first().click(),
    () => app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()),
  ];
  for (const focusPlace of focusPlaces) {
    await focusPlace();
    await app.keyboard.press('ControlOrMeta+f');
    await expect(findBox(app)).toBeFocused();
    await app.keyboard.press('Escape');
    await expect(findBox(app)).toBeHidden();
  }

  await app.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await app.keyboard.press('ControlOrMeta+h');
  await expect(app.getByRole('textbox', { name: 'Replace' })).toBeVisible();
});
