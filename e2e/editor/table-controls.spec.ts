import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote } from '../support/actions';

// #449: header-row toggle, delete table and a findable column resize handle.

async function insertTable(app: Page, title: string): Promise<void> {
  await createNote(app, { title, body: 'Before' });
  await app.getByTitle('Insert Table').click();
  await app.getByRole('button', { name: '2 by 3 table' }).click();
  await expect(activeEditor(app).locator('table')).toHaveCount(1);
}

async function openMenu(app: Page, name: 'Row options' | 'Column options', cellIndex: number): Promise<void> {
  await activeEditor(app).locator('table td, table th').nth(cellIndex).hover();
  await app.getByRole('button', { name }).click();
}

async function settle(app: Page): Promise<void> {
  // Local persistence of the Yjs update has no DOM-observable signal (see support/actions.ts).
  await app.waitForTimeout(1000);
}

test('header row toggles on and off and survives a reload', async ({ app }) => {
  await insertTable(app, `Table header ${Date.now()}`);
  const table = activeEditor(app).locator('table');

  await openMenu(app, 'Row options', 4); // a body row: the toggle still acts on the first row
  const toggle = app.getByRole('button', { name: 'Header row' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(table.locator('tr').first().locator('th')).toHaveCount(3);
  await expect(table.locator('tr').nth(1).locator('th')).toHaveCount(0);
  await settle(app);

  await app.reload();
  await waitForAppReady(app);
  await expect(activeEditor(app).locator('table tr').first().locator('th')).toHaveCount(3);

  await openMenu(app, 'Row options', 4);
  const toggleAgain = app.getByRole('button', { name: 'Header row' });
  await expect(toggleAgain).toHaveAttribute('aria-pressed', 'true');
  await toggleAgain.click();
  await expect(activeEditor(app).locator('table th')).toHaveCount(0);
  await expect(toggleAgain).toHaveAttribute('aria-pressed', 'false');
  await settle(app);

  await app.reload();
  await waitForAppReady(app);
  await expect(activeEditor(app).locator('table')).toHaveCount(1);
  await expect(activeEditor(app).locator('table th')).toHaveCount(0);
});

test('Delete table removes the table and keeps the rest of the note', async ({ app }) => {
  await insertTable(app, `Table delete ${Date.now()}`);
  await openMenu(app, 'Row options', 0);
  await app.getByRole('button', { name: 'Delete table' }).click();

  const editor = activeEditor(app);
  await expect(editor.locator('table')).toHaveCount(0);
  await expect(editor).toContainText('Before');
});

test('column resize handle shows at a column border and the width survives a reload', async ({ app }) => {
  await insertTable(app, `Table resize ${Date.now()}`);
  const cell = activeEditor(app).locator('table td').first();
  const box = (await cell.boundingBox())!;
  const borderX = box.x + box.width - 2;
  const y = box.y + box.height / 2;

  await app.mouse.move(borderX, y);
  const handle = activeEditor(app).locator('.column-resize-handle').first();
  await expect(handle).toHaveCSS('opacity', '1');

  await app.mouse.down();
  await app.mouse.move(borderX + 60, y, { steps: 6 });
  await expect(handle).toHaveCSS('opacity', '1');
  await app.mouse.up();

  const resized = activeEditor(app).locator('table td').first();
  await expect(resized).toHaveAttribute('colwidth', /\d+/);
  const width = await resized.getAttribute('colwidth');
  await settle(app);

  await app.reload();
  await waitForAppReady(app);
  await expect(activeEditor(app).locator('table td').first()).toHaveAttribute('colwidth', width!);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`row and column menus, ${colorScheme}`, async ({ app }) => {
    await app.setViewportSize({ width: 1280, height: 800 });
    await app.emulateMedia({ colorScheme });
    await insertTable(app, `Table menus ${colorScheme} ${Date.now()}`);

    await openMenu(app, 'Row options', 0);
    await expect(app.getByRole('button', { name: 'Delete table' })).toBeVisible();
    await app.screenshot({ path: test.info().outputPath(`row-menu-${colorScheme}-1280.png`) });
    await app.keyboard.press('Escape');

    await openMenu(app, 'Column options', 1);
    await expect(app.getByRole('button', { name: 'Delete column' })).toBeVisible();
    await app.screenshot({ path: test.info().outputPath(`column-menu-${colorScheme}-1280.png`) });
  });
}
