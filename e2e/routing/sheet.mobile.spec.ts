import type { CDPSession, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeTitleInput, createFolder, inBothThemes, selectFolder, typeInEditor } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// The bottom sheet and the full sheet (#823): safe areas, drag to dismiss, Back to close.
// Move to folder is the bottom sheet, Version history the full sheet; the action sheet has no
// screen yet, so an e2e-only hook opens one. The drag uses CDP touch events and the notch
// is a CDP safe-area override, so these run in Chromium only.

const PHONE = { width: 390, height: 844 };
const TOP_INSET = 59;
const BOTTOM_INSET = 34;

async function phone(page: Page): Promise<CDPSession> {
  await page.setViewportSize(PHONE);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: TOP_INSET, bottom: BOTTOM_INSET } });
  return cdp;
}

async function shots(page: Page, what: string) {
  await inBothThemes(page, (theme) =>
    page.screenshot({ path: test.info().outputPath(`${what}-${theme}-${PHONE.width}.png`) }),
  );
}

// The sheet slides in over 300 ms; wait until its top edge stops moving.
async function settled(el: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  let last = -1;
  await expect
    .poll(async () => {
      const y = (await el.boundingBox())?.y ?? -2;
      const same = y === last;
      last = y;
      return same;
    })
    .toBe(true);
  return (await el.boundingBox())!;
}

// One finger on `from`, moving `distance` px down, slowly enough that it is not a flick.
async function dragDown(cdp: CDPSession, page: Page, from: { x: number; y: number }, distance: number) {
  const touch = (type: string, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: from.x, y }] });
  await touch('touchStart', from.y);
  for (let step = 1; step <= 10; step++) {
    await touch('touchMove', from.y + (distance * step) / 10);
    await page.waitForTimeout(20);
  }
  // Rest before letting go, so the release has no velocity and only the distance counts.
  await page.waitForTimeout(250);
  await touch('touchEnd', from.y + distance);
}

async function newNoteInMain(page: Page, title: string) {
  await selectFolder(page, 'Main');
  const before = page.url();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.waitForURL((url) => url.href !== before);
  await expect(activeTitleInput(page)).toHaveValue('Untitled');
  await activeTitleInput(page).fill(title);
  await typeInEditor(page, 'Body.');
}

test('the bottom sheet sits on the screen edge, springs back from a short drag and closes on a long one', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CDP touch and safe-area emulation are Chromium only');
  await withMobilePage(browser, async (page) => {
    const cdp = await phone(page);
    await createFolder(page, 'Sheet target');
    const title = `Sheet bottom ${Date.now()}`;
    await newNoteInMain(page, title);
    await page.getByRole('button', { name: /^Back to (?!notes$)/ }).click();
    const row = page.getByTestId('note-row').filter({ hasText: title });
    await expect(row).toBeVisible();
    const listUrl = page.url();

    const open = async () => {
      await row.click({ button: 'right', position: { x: 12, y: 12 } });
      await page.getByRole('menuitem', { name: 'Move to folder…' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Move to folder');
      return dialog;
    };

    const dialog = await open();
    const box = await settled(dialog);
    const innerHeight = await page.evaluate(() => window.innerHeight);
    expect(box.y + box.height).toBe(innerHeight);
    expect(box.width).toBe(PHONE.width);
    expect(box.y).toBeGreaterThanOrEqual(TOP_INSET);
    await shots(page, 'move-to-folder-bottom');

    // 10 % of its height: it springs back.
    const grabber = (await page.locator('[data-slot="sheet-grabber"]').boundingBox())!;
    const handle = { x: grabber.x + grabber.width / 2, y: grabber.y + grabber.height / 2 };
    await dragDown(cdp, page, handle, box.height * 0.1);
    await expect.poll(async () => (await dialog.boundingBox())!.y).toBe(box.y);
    await expect(dialog).toBeVisible();

    // 40 % of its height: it closes.
    await dragDown(cdp, page, handle, box.height * 0.4);
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(listUrl);

    // Back closes it too, on the same screen.
    await open();
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(page.url()).toBe(listUrl);
  });
});

test('the full sheet keeps its title and close button clear of the status bar', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Safe-area emulation is Chromium only');
  await withMobilePage(browser, async (page) => {
    await phone(page);
    await newNoteInMain(page, `Sheet full ${Date.now()}`);
    const noteUrl = page.url();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Version history' }).click();
    const dialog = page.getByRole('dialog', { name: 'Version history' });
    await expect(dialog).toBeVisible();
    const box = await settled(dialog);
    expect(box).toMatchObject({ x: 0, y: 0, width: PHONE.width, height: PHONE.height });

    const title = (await dialog.getByRole('heading', { name: 'Version history' }).boundingBox())!;
    expect(title.y).toBeGreaterThanOrEqual(TOP_INSET);
    const close = (await dialog.getByRole('button', { name: 'Close' }).boundingBox())!;
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    expect(close.y).toBeGreaterThanOrEqual(TOP_INSET);
    await shots(page, 'version-history-full');

    await page.goBack();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(noteUrl);
    await expect(activeTitleInput(page)).toBeVisible();
  });
});

test('the action sheet lists its rows, with Cancel last', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Safe-area emulation is Chromium only');
  await withMobilePage(browser, async (page) => {
    await phone(page);
    await page.evaluate(() => window.__journalE2E!.showActionSheet());
    const dialog = page.getByRole('dialog', { name: 'Note actions' });
    await expect(dialog).toBeVisible();
    const box = await settled(dialog);
    expect(box.y + box.height).toBe(PHONE.height);

    const rows = dialog.getByRole('menuitem');
    await expect(rows).toHaveText(['Rename', 'Share', 'Delete']);
    for (const row of await rows.all()) expect((await row.boundingBox())!.height).toBe(52);
    await shots(page, 'action-sheet');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});
