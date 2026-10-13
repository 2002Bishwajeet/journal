import { test, expect } from '../fixtures';
import { createFolder, foldersNav, selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #620: a folder is renamed from its sidebar menu; the new name shows in the sidebar and the
// note list header, survives a reload, and Escape / an empty name keep the old one.
// (Cross-tab sync needs a real Homebase; push field preservation is covered in
// src/__tests__/folderRename.test.ts.)

const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

async function openRename(page: import('@playwright/test').Page, name: string) {
  await foldersNav(page).getByRole('button', { name, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename Folder' }).click();
  return page.getByRole('dialog').getByPlaceholder('Folder Name');
}

test('rename a folder from the sidebar menu', async ({ app }) => {
  await assertTestOrigin(app);
  await app.setViewportSize({ width: 1280, height: 800 });
  await createFolder(app, 'Trips');
  await selectFolder(app, 'Trips');
  const url = app.url();

  // Escape and an empty name leave the old name.
  let input = await openRename(app, 'Trips');
  await expect(input).toHaveValue('Trips');
  await input.fill('Nope');
  await app.keyboard.press('Escape');
  await expect(app.getByRole('dialog')).toBeHidden();
  await expect(foldersNav(app).getByRole('button', { name: 'Trips', exact: true })).toBeVisible();

  input = await openRename(app, 'Trips');
  await input.fill('   ');
  await expect(app.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
  await app.keyboard.press('Escape');

  // Screenshots of the rename dialog, then rename for real (Enter saves, trimmed).
  for (const vp of viewports) {
    await app.setViewportSize({ width: vp.width, height: vp.height });
    // Mobile shows the sidebar only at the root, so step back out of the folder view.
    if (vp.name === 'mobile') await app.getByRole('button').first().click();
    for (const scheme of ['light', 'dark'] as const) {
      await app.emulateMedia({ colorScheme: scheme });
      await openRename(app, 'Trips');
      await expect(app.getByRole('dialog')).toBeVisible();
      await app.screenshot({ path: test.info().outputPath(`rename-dialog-${scheme}-${vp.name}.png`), animations: 'disabled' });
      await app.keyboard.press('Escape');
      await expect(app.getByRole('dialog')).toBeHidden();
    }
  }

  await app.setViewportSize({ width: 1280, height: 800 });
  await app.goto(url);
  input = await openRename(app, 'Trips');
  await input.fill('  Journeys  ');
  await input.press('Enter');

  await expect(foldersNav(app).getByRole('button', { name: 'Journeys', exact: true })).toBeVisible();
  await expect(foldersNav(app).getByRole('button', { name: 'Trips', exact: true })).toHaveCount(0);
  await expect(app).toHaveTitle(/Journeys/);

  await app.reload();
  await expect(foldersNav(app).getByRole('button', { name: 'Journeys', exact: true })).toBeVisible();
  await expect(app).toHaveTitle(/Journeys/);
});
