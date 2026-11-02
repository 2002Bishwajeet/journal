import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createFolder, foldersNav, screenshotInBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #824: Share Note, Share Folder and Version history are full sheets on a phone. Their
// header clears the status bar, the close button is 44 px, and the primary button sits
// above the home indicator. Back closes them. (Mark as Collaborative is part of Share Note
// since #682.) The notch is a CDP safe-area override, so these run in Chromium only.

const VIEWPORT = { width: 393, height: 852 };
const TOP_INSET = 59;
const BOTTOM_INSET = 34;

const noteRow = (page: Page) => page.locator('[data-testid=note-row]:visible');

async function notch(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: TOP_INSET, bottom: BOTTOM_INSET } });
}

/** A note in Main, back on the note list. */
async function makeNote(page: Page) {
  await foldersNav(page).getByRole('button', { name: 'Main', exact: true }).tap();
  await page.getByRole('button', { name: 'New note', exact: true }).tap();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toBeVisible();
  await page.getByRole('button', { name: /^Back to (?!notes$)/ }).tap();
  await expect.poll(() => new URL(page.url()).pathname.split('/').filter(Boolean).length).toBe(1);
  await expect(noteRow(page)).toHaveCount(1);
}

async function openRowMenuItem(page: Page, name: string) {
  await noteRow(page).first().click({ button: 'right', position: { x: 12, y: 12 } });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await menu.getByRole('menuitem', { name, exact: true }).click();
}

async function expectSheet(page: Page, name: string, primary?: string) {
  const sheet = page.getByRole('dialog', { name });
  await expect(sheet).toBeVisible();
  // The sheet slides in over 300 ms; wait until its top edge stops moving.
  await expect.poll(async () => (await sheet.boundingBox())?.y).toBe(0);
  const title = (await sheet.getByRole('heading', { name }).boundingBox())!;
  expect(title.y).toBeGreaterThanOrEqual(TOP_INSET);
  const close = (await sheet.getByRole('button', { name: 'Close', exact: true }).boundingBox())!;
  expect(close.width).toBeGreaterThanOrEqual(44);
  expect(close.height).toBeGreaterThanOrEqual(44);
  if (primary) {
    const button = (await sheet.getByRole('button', { name: primary, exact: true }).boundingBox())!;
    expect(VIEWPORT.height - (button.y + button.height)).toBeLessThanOrEqual(BOTTOM_INSET + 24);
  }
  await screenshotInBothThemes(page, (theme) => `${name.toLowerCase().replace(/\s+/g, '-')}-${theme}-393x852.png`);
}

async function expectBackCloses(page: Page, name: string) {
  const url = page.url();
  await page.goBack();
  await expect(page.getByRole('dialog', { name })).toBeHidden();
  expect(page.url()).toBe(url);
}

test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP safe-area emulation is Chromium only');
});

test('Share Note is a full sheet with Done in thumb reach', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await notch(page);
    await makeNote(page);
    await openRowMenuItem(page, 'Share…');
    await expectSheet(page, 'Share Note', 'Done');
    await expectBackCloses(page, 'Share Note');
  });
});

test('Share Folder is a full sheet with Share folder in thumb reach', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await notch(page);
    await createFolder(page, 'Trips');
    const folder = foldersNav(page).getByRole('button', { name: 'Trips', exact: true });
    const box = (await folder.boundingBox())!;
    await page.mouse.click(box.x + 24, box.y + box.height / 2, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Share folder…' }).click();
    await expectSheet(page, 'Share Folder', 'Share folder');
    await expectBackCloses(page, 'Share Folder');
  });
});

test('Version history is a full sheet', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await notch(page);
    await makeNote(page);
    await noteRow(page).first().tap();
    await page.getByRole('button', { name: 'More' }).tap();
    await page.getByRole('menuitem', { name: 'Version history' }).tap();
    await expectSheet(page, 'Version history');
    await expectBackCloses(page, 'Version history');
  });
});
