import type { CDPSession, Page, Video } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { createFolder, selectFolder } from '../support/actions';

// One set of motion tokens (#857): push and pop, sheets and dialogs run with the --ease-* and
// --duration-* custom properties of index.css, and with reduced motion none of them runs long.
// The drags and the recordings use CDP touch events, so those run in Chromium only.

const FOLDER = 'Motion';
const SIZE = { width: 393, height: 852 };

type Run = { what: string; duration: number; easing: string };

// Records every slide we start (its new screen's animation) and every CSS animation that
// starts on a sheet or a centred dialog.
async function record(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { runs: Run[] };
    w.runs = [];
    const add = (what: string, a: Animation) => {
      const effect = a.effect as KeyframeEffect;
      w.runs.push({ what, duration: Number(effect.getTiming().duration), easing: effect.getKeyframes()[0]?.easing ?? '' });
    };
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = ((update: () => Promise<void>) => {
      const nav = document.documentElement.dataset.nav ?? 'forward';
      const transition = start(update);
      transition.ready.then(
        () => {
          for (const a of document.getAnimations()) {
            if ((a.effect as KeyframeEffect).pseudoElement === '::view-transition-new(root)') add(`slide-${nav}`, a);
          }
        },
        () => {},
      );
      return transition;
    }) as typeof document.startViewTransition;
    document.addEventListener(
      'animationstart',
      (e) => {
        const el = e.target as HTMLElement;
        const slot = el.dataset?.slot;
        if (slot !== 'sheet-content' && slot !== 'dialog-content') return;
        const a = el.getAnimations().find((x) => x instanceof CSSAnimation && x.animationName === e.animationName);
        if (a) return add(slot, a);
        // A zeroed animation (reduced motion) has already ended: read what it ran with.
        const style = getComputedStyle(el);
        w.runs.push({ what: slot, duration: parseFloat(style.animationDuration) * 1000, easing: style.animationTimingFunction });
      },
      true,
    );
  });
}

const runs = (page: Page, prefix: string) =>
  page.evaluate((p) => (window as unknown as { runs: Run[] }).runs.filter((r) => r.what.startsWith(p)), prefix);

// The build minifies the tokens (350ms -> .35s, 0.32 -> .32), so compare numbers.
const token = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const ms = async (page: Page, name: string) => {
  const value = await token(page, name);
  return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
};
const curve = (easing: string) => easing.match(/[\d.]+/g)?.map(Number);

/** Runs `act`, which must start one slide, and waits until that slide has played. */
async function slide(page: Page, act: () => Promise<void>) {
  const before = (await runs(page, 'slide-')).length;
  await act();
  await expect.poll(async () => (await runs(page, 'slide-')).length).toBe(before + 1);
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => !(a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition')),
  );
}

const noteBack = (page: Page) => page.getByRole('button', { name: /^Back to (?!notes$)/ });
const listBack = (page: Page) => page.getByRole('button', { name: 'Back to notes' });
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Sidebar' });
const row = (page: Page) => page.getByTestId('note-row').first();

/** A folder with one note in it; ends on the sidebar. */
async function folderWithNote(page: Page) {
  await createFolder(page, FOLDER);
  await selectFolder(page, FOLDER);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await noteBack(page).click();
  await expect(row(page)).toBeVisible();
  await listBack(page).click();
  await expect(sidebar(page)).toBeVisible();
}

async function openMoveSheet(page: Page) {
  await row(page).click({ button: 'right', position: { x: 12, y: 12 } });
  await page.getByRole('menuitem', { name: 'Move to folder…' }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toContainText('Move to folder');
  return sheet;
}

/** One finger on the sheet's grabber, `distance` px down in steps; lifts unless `hold`. */
async function dragGrabber(page: Page, cdp: CDPSession, distance: number, hold = false) {
  const g = (await page.locator('[data-slot="sheet-grabber"]').boundingBox())!;
  const x = g.x + g.width / 2;
  const y = g.y + g.height / 2;
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', at: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: at }] });
  await touch('touchStart', y);
  for (let step = 1; step <= 10; step++) {
    await touch('touchMove', y + (distance * step) / 10);
    await page.waitForTimeout(20);
  }
  if (hold) return () => touch('touchEnd', y + distance);
  await touch('touchEnd', y + distance);
  return async () => {};
}

test('push, pop, a bottom sheet and a centred dialog run with the motion tokens', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await record(page);
    const ease = curve(await token(page, '--ease-standard'));
    const push = await ms(page, '--duration-push');
    expect(ease).toEqual([0.32, 0.72, 0, 1]);
    expect(push).toBe(350);

    // New folder is a centred dialog: fade plus scale, at the fade duration.
    await createFolder(page, FOLDER);
    const [dialog] = await runs(page, 'dialog-content');
    expect(dialog.duration).toBe(await ms(page, '--duration-fade'));
    expect(curve(dialog.easing)).toEqual(ease);

    // folder -> list -> note -> Back -> Back, each a slide at the push duration and curve.
    await slide(page, () => selectFolder(page, FOLDER));
    await slide(page, () => page.getByRole('button', { name: 'New note', exact: true }).click());
    await slide(page, () => noteBack(page).click());
    await expect(row(page)).toBeVisible();
    await slide(page, () => listBack(page).click());
    await expect(sidebar(page)).toBeVisible();
    const slides = await runs(page, 'slide-');
    expect(slides.map((s) => s.what)).toEqual(['slide-forward', 'slide-forward', 'slide-back', 'slide-back']);
    for (const s of slides) {
      expect(s.duration, s.what).toBe(push);
      expect(curve(s.easing), s.what).toEqual(ease);
    }

    // A bottom sheet opens at the sheet duration and curve.
    await selectFolder(page, FOLDER);
    await openMoveSheet(page);
    const [sheet] = await runs(page, 'sheet-content');
    expect(sheet.duration).toBe(await ms(page, '--duration-sheet'));
    expect(curve(sheet.easing)).toEqual(ease);
  });
});

test('with reduced motion nothing runs longer than 160 ms, and a drag still follows the finger', async ({
  browser,
  browserName,
}) => {
  await withMobilePage(browser, async (page) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await folderWithNote(page);
    await record(page);
    const longest = async () =>
      Math.max(0, ...(await runs(page, '')).map((r) => r.duration));

    await selectFolder(page, FOLDER);
    await row(page).click();
    await noteBack(page).click();
    await expect(row(page)).toBeVisible();
    // No slide starts; a sheet's slide-up is zeroed by the global rule.
    const sheet = await openMoveSheet(page);
    await expect.poll(async () => (await runs(page, 'sheet-content')).length).toBeGreaterThan(0);
    expect(await runs(page, 'slide-')).toEqual([]);
    expect(await longest()).toBeLessThanOrEqual(160);

    if (browserName !== 'chromium') return;
    // Direct manipulation is not animation: the sheet still moves with the finger.
    const top = (await sheet.boundingBox())!.y;
    const cdp = await page.context().newCDPSession(page);
    const lift = await dragGrabber(page, cdp, 120, true);
    await expect.poll(async () => (await sheet.boundingBox())!.y - top).toBeGreaterThan(100);
    await lift();
  });
});

// Screen recordings at 393 px, saved as test output for the PR (#857).
async function recorded(browser: Parameters<typeof withMobilePage>[0], name: string, body: (page: Page) => Promise<void>) {
  let video: Video | null = null;
  await withMobilePage(
    browser,
    async (page) => {
      video = page.video();
      await body(page);
    },
    { recordVideo: { dir: test.info().outputPath('raw-video'), size: SIZE } },
  );
  await (video as Video | null)?.saveAs(test.info().outputPath(`${name}-light-393x852.webm`));
}

test.describe('recordings', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'CDP touch is Chromium only');

  test('folder, list, note, Back, Back', async ({ browser }) => {
    await recorded(browser, 'push-pop', async (page) => {
      await folderWithNote(page);
      await record(page);
      await slide(page, () => selectFolder(page, FOLDER));
      await slide(page, () => row(page).click());
      await page.waitForTimeout(400);
      await slide(page, () => noteBack(page).click());
      await slide(page, () => listBack(page).click());
      await page.waitForTimeout(400);
    });
  });

  test('a bottom sheet opens and is dragged down to close', async ({ browser }) => {
    await recorded(browser, 'sheet-drag-dismiss', async (page) => {
      await folderWithNote(page);
      await selectFolder(page, FOLDER);
      const sheet = await openMoveSheet(page);
      await page.waitForTimeout(600);
      const cdp = await page.context().newCDPSession(page);
      await dragGrabber(page, cdp, (await sheet.boundingBox())!.height * 0.5);
      await expect(sheet).toBeHidden();
      await page.waitForTimeout(400);
    });
  });

  test('the tab bar and the New note button come back after a note', async ({ browser }) => {
    await recorded(browser, 'tab-bar-fab-return', async (page) => {
      await folderWithNote(page);
      await record(page);
      const tabBar = page.getByRole('navigation', { name: 'Tabs' });
      await slide(page, () => selectFolder(page, FOLDER));
      await slide(page, () => row(page).click());
      await expect(tabBar).toBeHidden();
      await page.waitForTimeout(400);
      await slide(page, () => noteBack(page).click());
      await expect(tabBar).toBeVisible();
      await expect(page.getByRole('button', { name: 'New note', exact: true })).toBeVisible();
      await page.waitForTimeout(600);
    });
  });
});
