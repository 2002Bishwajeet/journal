import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { createNote, inBothThemes, selectFolder } from '../support/actions';

// Desktop Trash: Delete forever asks first, in a dialog like the Empty Trash one.
// Cancel keeps the note in Trash; Delete Note removes it.

const KEEP = 'Second thoughts';
const GONE = 'Really gone';

const noteRow = (page: Page, title: string) => page.getByTestId('note-row').filter({ hasText: title });
const trashItem = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });

async function moveToTrash(page: Page, title: string) {
  await noteRow(page, title).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('dialog', { name: 'Move to Trash?' }).getByRole('button', { name: 'Move to Trash' }).click();
  await expect(noteRow(page, title)).toHaveCount(0);
}

test('Delete forever in Trash asks first; Cancel keeps the note, Delete Note removes it', async ({ app }) => {
  test.setTimeout(60_000);
  await app.setViewportSize({ width: 1280, height: 800 });
  await selectFolder(app, 'Main');
  await createNote(app, { title: KEEP, body: 'Stays in Trash' });
  await createNote(app, { title: GONE, body: 'Leaves for good' });
  await moveToTrash(app, KEEP);
  await moveToTrash(app, GONE);
  await app.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Trash/ }).click();
  await expect(trashItem(app, KEEP)).toBeVisible();
  await expect(trashItem(app, GONE)).toBeVisible();

  const confirm = app.getByRole('dialog', { name: 'Delete note forever?' });
  await trashItem(app, KEEP).getByRole('button', { name: 'Delete forever' }).click();
  await expect(confirm).toContainText("This note will be deleted permanently. You can't undo this.");
  await inBothThemes(app, (theme) =>
    app.screenshot({ path: test.info().outputPath(`trash-delete-confirm-${theme}-1280.png`), animations: 'disabled' }),
  );
  await app.emulateMedia({ colorScheme: 'light' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(trashItem(app, KEEP)).toBeVisible();

  await trashItem(app, GONE).getByRole('button', { name: 'Delete forever' }).click();
  await confirm.getByRole('button', { name: 'Delete Note' }).click();
  await expect(confirm).toBeHidden();
  await expect(trashItem(app, GONE)).toHaveCount(0);
  await expect(trashItem(app, KEEP)).toBeVisible();
});
