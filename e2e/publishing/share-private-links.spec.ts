import { test, expect } from '../fixtures';
import { activeEditor, createNote, inBothThemes, waitForNoteSaved } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #617: making a note public that links to private notes asks about them first.
// Hermetic, so this covers the question and its evidence; publishing itself needs a
// real Homebase (the live tier) and the choices are covered by shareDialogMakePublic.test.ts.

test('making a note public that links to a private note lists it first', async ({ app }) => {
  await assertTestOrigin(app);
  await app.setViewportSize({ width: 1280, height: 720 });
  const stamp = Date.now();
  const target = `Linked target ${stamp}`;
  const source = `Linker ${stamp}`;
  await createNote(app, { title: target, body: 'A private note.' });
  await createNote(app, { title: source, body: `See [[${target}` });
  await activeEditor(app).press('Enter');
  await waitForNoteSaved(app);

  await app.getByRole('button').filter({ hasText: source }).first().click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Share' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Make Note Public' }).click();

  await expect(dialog.getByText('This note links to 1 private note.')).toBeVisible();
  await expect(dialog.getByText(target)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Make these public too' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Continue anyway' })).toBeVisible();

  const shoot = (theme: string, viewport: number) =>
    app.screenshot({ path: test.info().outputPath(`links-step-${theme}-${viewport}.png`) });
  await inBothThemes(app, (theme) => shoot(theme, 1280));
  await app.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole('button', { name: 'Continue anyway' })).toBeVisible();
  await inBothThemes(app, (theme) => shoot(theme, 390));
});
