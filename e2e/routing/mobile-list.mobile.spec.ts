import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { withMobilePage } from '../support/mobile';
import { createFolder, selectFolder, THEMES } from '../support/actions';

// The phone list screen has one header, sticky group headers, 44 px controls
// and a push/pop slide (#779).

const FOLDER = 'Phone list';
const rows = (page: Page) => page.getByTestId('note-row');
const listViewport = (page: Page) =>
  page.locator('[data-radix-scroll-area-viewport]').filter({ has: rows(page).first() });

async function box(locator: ReturnType<Page['locator']>) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

async function addNote(page: Page) {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: FOLDER })).toBeVisible();
}

test('the list screen has one 44 px header, and the group header sticks', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await createFolder(page, FOLDER);
    await selectFolder(page, FOLDER);
    await expect(page.getByRole('heading', { name: FOLDER })).toBeVisible();

    await expect(page.getByRole('button', { name: 'Back to notes' })).toHaveCount(1);
    await expect(page.getByText(FOLDER, { exact: true }).locator('visible=true')).toHaveCount(1);

    for (const name of ['Back to notes', 'Sort notes', 'New']) {
      const b = await box(page.getByRole('button', { name, exact: true }));
      expect(b.width, name).toBeGreaterThanOrEqual(44);
      expect(b.height, name).toBeGreaterThanOrEqual(44);
    }

    // Fill the list until it scrolls at least 900 px.
    await addNote(page);
    const viewport = listViewport(page);
    await page.screenshot({ path: test.info().outputPath('list-top-light-393x852.png') });
    for (let i = 0; i < 40; i++) {
      const room = await viewport.evaluate((el) => el.scrollHeight - el.clientHeight);
      if (room >= 900) break;
      await addNote(page);
    }
    await viewport.evaluate((el) => { el.scrollTop = 900; });
    await expect.poll(() => viewport.evaluate((el) => el.scrollTop)).toBe(900);

    const header = page.getByRole('button', { name: /^Today/ }).first();
    const top = (await box(viewport)).y;
    expect((await box(header)).y).toBe(top);
    expect((await box(header)).height).toBeGreaterThanOrEqual(44);
    // The count shows without hover on a touch screen.
    await expect(header.locator('span').last()).toHaveCSS('opacity', '1');

    for (const colorScheme of THEMES) {
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('html')).toHaveClass(new RegExp(colorScheme));
      await page.screenshot({ path: test.info().outputPath(`list-scrolled-${colorScheme}-393x852.png`) });
    }
  });
});

test('going back marks the slide direction for the transition', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await createFolder(page, FOLDER);
    await selectFolder(page, FOLDER);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const back = page.getByRole('button', { name: 'Back', exact: true });
    await expect(back).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { navSeen: string[] }).navSeen = [];
      new MutationObserver(() =>
        (window as unknown as { navSeen: string[] }).navSeen.push(document.documentElement.dataset.nav ?? ''),
      ).observe(document.documentElement, { attributes: true, attributeFilter: ['data-nav'] });
    });
    await back.click();
    await expect(page.getByRole('heading', { name: FOLDER })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { navSeen: string[] }).navSeen)).toContain('back');
    await expect(page.locator('html')).not.toHaveAttribute('data-nav', /.+/);
  });
});

test('in Trash, Restore and Delete forever are 44 px and 8 px apart', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await createFolder(page, FOLDER);
    await selectFolder(page, FOLDER);
    await addNote(page);
    await rows(page).first().getByRole('button').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
    await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
    await page.getByRole('button', { name: 'Back to notes' }).click();

    await page.getByRole('button', { name: /^Trash/ }).click();
    const back = await box(page.getByRole('button', { name: 'Back to notes' }));
    expect(back.width).toBeGreaterThanOrEqual(44);
    expect(back.height).toBeGreaterThanOrEqual(44);
    const empty = await box(page.getByRole('button', { name: 'Empty Trash' }));
    expect(empty.height).toBeGreaterThanOrEqual(44);

    const restore = await box(page.getByRole('button', { name: 'Restore note' }));
    const del = await box(page.getByRole('button', { name: 'Delete forever' }));
    for (const b of [restore, del]) {
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    expect(del.x - (restore.x + restore.width)).toBeGreaterThanOrEqual(8);
    await page.screenshot({ path: test.info().outputPath('trash-light-393x852.png') });
  });
});
