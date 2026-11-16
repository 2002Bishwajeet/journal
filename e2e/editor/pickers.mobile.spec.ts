import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, inBothThemes } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// On a phone the link, table and callout-type pickers are sheets, not popovers or browser
// prompts, and the slash menu docks above the keyboard toolbar (#827). Alignment is in the
// Aa panel (#1272, context-bar.mobile.spec.ts).

const toolbar = (page: Page) => page.locator('[data-mobile-toolbar]');
const editorLink = (page: Page) => activeEditor(page).locator('a');

async function newNote(page: Page, body: string) {
  await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).tap();
  await page.getByRole('button', { name: 'New note', exact: true }).tap();
  await activeEditor(page).tap();
  await page.keyboard.insertText(body);
  await expect(toolbar(page)).toBeVisible();
}

// The sheet slides in over 300 ms; wait until its top edge stops moving.
async function settled(el: Locator) {
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

// An open sheet sits on the bottom edge, and Back closes it without leaving the note.
async function expectBottomSheetThenBack(page: Page, sheet: Locator) {
  await expect(sheet).toBeVisible();
  const box = await settled(sheet);
  expect(box.y + box.height).toBe(await page.evaluate(() => window.innerHeight));
  expect(box.width).toBe(393);
  const noteUrl = page.url();
  await page.goBack();
  await expect(sheet).toBeHidden();
  expect(page.url()).toBe(noteUrl);
  await expect(activeEditor(page)).toBeVisible();
}

// Screenshots at 390 px, light then dark; back to the 393 px profile afterwards.
async function shots(page: Page, sheet: Locator, what: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await settled(sheet);
  await inBothThemes(page, (theme) =>
    page.screenshot({ path: test.info().outputPath(`${what}-${theme}-390.png`) }),
  );
  await page.setViewportSize({ width: 393, height: 852 });
  await settled(sheet);
}

test('Add Link opens a sheet, links the selected word, and reopening it removes the link', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    let prompts = 0;
    page.on('dialog', (dialog) => {
      prompts++;
      void dialog.dismiss();
    });
    await newNote(page, 'Hello world');
    await page.keyboard.press('Control+Shift+ArrowLeft'); // selects "world"

    await toolbar(page).getByTitle('Add Link').tap();
    const sheet = page.getByRole('dialog', { name: 'Link' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Text')).toHaveValue('world');
    const url = sheet.getByLabel('URL');
    await expect(url).toHaveAttribute('type', 'url');
    await expect(url).toHaveAttribute('inputmode', 'url');
    await expect(sheet.getByRole('button', { name: 'Remove link' })).toHaveCount(0);
    await url.fill('example.com'); // a bare host gets https://
    await shots(page, sheet, 'link-sheet');
    await sheet.getByRole('button', { name: 'Done' }).tap();

    await expect(sheet).toBeHidden();
    await expect(editorLink(page)).toHaveText('world');
    await expect(editorLink(page)).toHaveAttribute('href', 'https://example.com');
    await expect(activeEditor(page)).toBeFocused();

    // Reopen on the link: it shows the link and can remove it.
    await toolbar(page).getByTitle('Add Link').tap();
    await expect(sheet.getByLabel('URL')).toHaveValue('https://example.com');
    await sheet.getByRole('button', { name: 'Remove link' }).tap();
    await expect(sheet).toBeHidden();
    await expect(editorLink(page)).toHaveCount(0);
    await expect(activeEditor(page)).toContainText('Hello world');

    await toolbar(page).getByTitle('Add Link').tap();
    await expectBottomSheetThenBack(page, sheet);
    expect(prompts).toBe(0);
  });
});

test('Table opens a sheet with steppers and inserts the size they show', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await newNote(page, 'Table below');
    await toolbar(page).getByTitle('Insert Table').tap();
    const sheet = page.getByRole('dialog', { name: 'Insert table' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('group', { name: 'Rows' })).toContainText('3');
    await expect(sheet.getByRole('group', { name: 'Columns' })).toContainText('3');

    await sheet.getByRole('button', { name: 'Fewer rows' }).tap();
    await sheet.getByRole('button', { name: 'More columns' }).tap();
    await shots(page, sheet, 'table-sheet');
    await sheet.getByRole('button', { name: 'Insert table' }).tap();

    await expect(sheet).toBeHidden();
    await expect(activeEditor(page).locator('table tr')).toHaveCount(2);
    await expect(activeEditor(page).locator('table tr').first().locator('td, th')).toHaveCount(4);

    await toolbar(page).getByTitle('Insert Table').tap();
    await expectBottomSheetThenBack(page, sheet);
  });
});

test('the callout icon opens an action sheet and Warning sets the type', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await newNote(page, '/callout');
    await page.locator('[data-slash-dock]').getByRole('button', { name: /^Callout/ }).tap();
    const callout = activeEditor(page).locator('[data-type="callout"]');
    await expect(callout).toHaveAttribute('data-variant', 'info');
    await page.keyboard.insertText('Careful');

    await callout.getByRole('button', { name: 'Callout type: info' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Callout type' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('menuitemradio')).toHaveText(['Info', 'Warning', 'Tip', 'Error']);
    await expect(sheet.getByRole('menuitemradio', { name: 'Info' })).toHaveAttribute('aria-checked', 'true');
    await shots(page, sheet, 'callout-sheet');
    await sheet.getByRole('menuitemradio', { name: 'Warning' }).tap();
    await expect(sheet).toBeHidden();
    await expect(callout).toHaveAttribute('data-variant', 'warning');

    await callout.getByRole('button', { name: 'Callout type: warning' }).tap();
    await expectBottomSheetThenBack(page, sheet);
  });
});

test('the slash menu docks above the keyboard toolbar, full width, with 48 px rows, and keeps filtering', async ({
  browser,
}) => {
  await withMobilePage(browser, async (page) => {
    await newNote(page, '');
    for (let i = 1; i <= 30; i++) {
      await page.keyboard.insertText(`Paragraph ${i}`);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.insertText('/');

    const dock = page.locator('[data-slash-dock]');
    const rows = dock.locator('[data-index]');
    await expect(rows.first()).toBeVisible();
    const menu = (await dock.locator('[data-index]').first().locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]').boundingBox())!;
    expect(menu.width).toBe(393);
    const bar = (await toolbar(page).boundingBox())!;
    expect(Math.abs(menu.y + menu.height - bar.y)).toBeLessThanOrEqual(1);
    for (const row of (await rows.all()).slice(0, 5)) {
      const box = (await row.boundingBox())!;
      if (box.y + box.height <= menu.y + menu.height) expect(box.height).toBeGreaterThanOrEqual(48);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await inBothThemes(page, (theme) =>
      page.screenshot({ path: test.info().outputPath(`slash-docked-${theme}-390.png`) }),
    );
    await page.setViewportSize({ width: 393, height: 852 });

    // The editor keeps focus, so typing still filters.
    await page.keyboard.insertText('head');
    await expect(activeEditor(page)).toBeFocused();
    await expect(rows.first()).toContainText('Heading');
    await expect(rows.filter({ hasText: 'Bullet List' })).toHaveCount(0);

    await rows.first().tap();
    await expect(dock.locator('[data-index]')).toHaveCount(0);
    await expect(activeEditor(page).locator('h1')).toHaveCount(1);
  });
});
