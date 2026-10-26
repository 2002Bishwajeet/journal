import type { CDPSession, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { selectFolder } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #778: the note list on a phone. A swipe locks to the horizontal axis after
// about 10px, an open row closes on scroll, and a pull-to-refresh stops the
// native scroll instead of fighting it. Touches go through CDP
// Input.dispatchTouchEvent, so the browser runs its real scroll gestures.

const COUNT = 20;
const pad = (i: number) => String(i).padStart(2, '0');

const seedFiles = () =>
  Array.from({ length: COUNT }, (_, k) => {
    const n = pad(k + 1);
    return {
      name: `note-${n}.md`,
      mimeType: 'text/markdown',
      buffer: Buffer.from(`---\ntitle: Note ${n} - a long title for the weekly planning and reading list\n---\nBody ${n} keeps going with a few more words so the preview line runs across the whole row\n`),
    };
  });

type Point = { x: number; y: number };

async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', p?: Point) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
}

/** Presses at `from`, moves to `to` in even steps and lifts, unless `hold` keeps the finger down. */
async function drag(cdp: CDPSession, from: Point, to: Point, { steps = 12, hold = false } = {}) {
  await touch(cdp, 'touchStart', from);
  for (let i = 1; i <= steps; i++) {
    await touch(cdp, 'touchMove', {
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    });
  }
  if (!hold) await touch(cdp, 'touchEnd');
}

/** Boots the iPhone page, imports COUNT notes into Main and opens the list. */
async function withNoteList(
  browser: Parameters<typeof withMobilePage>[0],
  body: (page: Page, cdp: CDPSession, rows: Locator) => Promise<void>,
) {
  await withMobilePage(browser, async (page) => {
    // No push slide (#779): raw CDP touches sent during it land on the view-transition overlay.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Data & storage' }).click();
    await dialog.locator('input[type="file"]').setInputFiles(seedFiles());
    await expect(page.getByText(`Successfully imported ${COUNT} notes`)).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('Escape');
    await selectFolder(page, 'Main');
    const rows = page.getByTestId('note-row');
    await expect(rows.first()).toBeVisible();
    const cdp = await page.context().newCDPSession(page);
    await body(page, cdp, rows);
  });
}

const viewportOf = (rows: Locator) => rows.first().locator('xpath=ancestor::*[@data-radix-scroll-area-viewport][1]');

/** The horizontal offset of every row's content, in px (0 when the row is shut). */
const rowOffsets = (rows: Locator) =>
  rows.evaluateAll((els) =>
    els.map((el) => {
      const content = el.querySelector<HTMLElement>('[role="button"]')!;
      const t = getComputedStyle(content).transform;
      return t === 'none' ? 0 : new DOMMatrix(t).m41;
    }),
  );

/** True when the row's trash button sits inside the row, not past its right edge. */
async function trashShown(row: Locator): Promise<boolean> {
  const rowBox = (await row.boundingBox())!;
  const box = await row.locator('button[aria-label="Move to Trash"]').boundingBox();
  return !!box && box.x + box.width <= rowBox.x + rowBox.width + 1 && box.x < rowBox.x + rowBox.width - 40;
}

test('a vertical scroll that drifts sideways scrolls the list and leaves every row shut', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Input.dispatchTouchEvent is Chromium only');
  test.setTimeout(120_000);
  await withNoteList(browser, async (_page, cdp, rows) => {
    const viewport = viewportOf(rows);
    // Finger moves up 200px and 60px to the left.
    await drag(cdp, { x: 260, y: 620 }, { x: 200, y: 420 });
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);
    expect((await rowOffsets(rows)).every((x) => x === 0)).toBe(true);
    for (let i = 0; i < 3; i++) expect(await trashShown(rows.nth(i))).toBe(false);
  });
});

test('a left swipe opens one row, another swipe or a scroll closes it', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Input.dispatchTouchEvent is Chromium only');
  test.setTimeout(120_000);
  await withNoteList(browser, async (page, cdp, rows) => {
    const first = rows.nth(0);
    const second = rows.nth(1);
    const y = (await first.boundingBox())!.y + 30;

    // 100px to the left, with a little vertical drift.
    await drag(cdp, { x: 300, y }, { x: 200, y: y + 6 });
    await expect.poll(() => trashShown(first)).toBe(true);
    await expect.poll(async () => (await rowOffsets(rows))[0]).toBe(-80);
    await expect(first.getByRole('button', { name: 'Move to Trash' })).toBeVisible();

    // Waits for the rows' 200ms background transition to settle before each shot.
    const settled = (scheme: 'light' | 'dark') =>
      page.evaluate(
        (s) => document.documentElement.classList.contains('dark') === (s === 'dark') &&
          getComputedStyle(document.querySelector('[data-testid="note-row"] [role="button"]')!).backgroundColor ===
            getComputedStyle(document.body).backgroundColor,
        scheme,
      );
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => settled('light')).toBe(true);
    await page.screenshot({ path: test.info().outputPath('row-swiped-light-393x852.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => settled('dark')).toBe(true);
    await page.screenshot({ path: test.info().outputPath('row-swiped-dark-393x852.png') });
    await page.emulateMedia({ colorScheme: 'light' });

    // Swiping a second row closes the first: one open row at a time.
    const y2 = (await second.boundingBox())!.y + 30;
    await drag(cdp, { x: 300, y: y2 }, { x: 200, y: y2 });
    await expect.poll(() => trashShown(second)).toBe(true);
    await expect.poll(() => trashShown(first)).toBe(false);

    // Scrolling the list closes the open row.
    await drag(cdp, { x: 200, y: 640 }, { x: 200, y: 440 });
    await expect.poll(() => trashShown(second)).toBe(false);
    expect((await rowOffsets(rows)).every((x) => x === 0)).toBe(true);
  });
});

test('a tap outside an open row closes it', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Input.dispatchTouchEvent is Chromium only');
  test.setTimeout(120_000);
  await withNoteList(browser, async (page, cdp, rows) => {
    const first = rows.nth(0);
    const y = (await first.boundingBox())!.y + 30;
    await drag(cdp, { x: 300, y }, { x: 200, y });
    await expect.poll(() => trashShown(first)).toBe(true);

    await page.getByRole('button', { name: 'Sort notes' }).tap();
    await expect.poll(() => trashShown(first)).toBe(false);
  });
});

test('a pull to refresh moves the spinner without scrolling the list or logging a passive-listener warning', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Input.dispatchTouchEvent is Chromium only');
  test.setTimeout(120_000);
  await withNoteList(browser, async (page, cdp, rows) => {
    const messages: string[] = [];
    page.on('console', (m) => messages.push(m.text()));

    const viewport = viewportOf(rows);
    const pulled = page.locator('[data-pull-to-refresh]').filter({ has: rows.first() }).locator('> div').last();
    const y = (await rows.first().boundingBox())!.y + 30;

    // Finger moves down 120px, and holds there.
    await drag(cdp, { x: 200, y }, { x: 200, y: y + 120 }, { hold: true });
    await expect.poll(() => pulled.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeGreaterThan(30);
    expect(await viewport.evaluate((el) => el.scrollTop)).toBe(0);
    await page.screenshot({ path: test.info().outputPath('pull-mid-light-393x852.png') });
    await touch(cdp, 'touchEnd');

    await expect.poll(() => pulled.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42)).toBe(0);
    expect(messages.filter((m) => /preventDefault inside passive event listener/i.test(m))).toEqual([]);
  });
});
