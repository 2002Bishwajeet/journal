import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';

// Settings → Account (#213): identity, sync status + Sync now, honest sign-out warning.

test('desktop: opens on Account with the identity, Sync now and a sign-out dialog', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');

  await expect(dialog.getByRole('tab', { name: 'Account' })).toHaveAttribute('aria-selected', 'true');
  const panel = dialog.getByRole('tabpanel');
  await expect(panel).toContainText('e2e-owner.homebase.test');
  await expect(panel.getByRole('status')).not.toBeEmpty();

  await panel.getByRole('button', { name: 'Sync now' }).click();
  await expect(panel.getByRole('status')).toContainText('Up to date · last synced Just now');

  await panel.getByRole('button', { name: 'Sign out' }).click();
  const confirm = app.getByRole('dialog', { name: 'Sign out?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
});

test('a pending change: both sign-out entry points warn it will be lost', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  // The hermetic backend is unreachable, so the new note stays unsynced.
  await createNote(app, { title: 'Unsynced', body: 'Not on Homebase yet' });

  await app.getByRole('button', { name: 'Settings' }).click();
  const panel = app.getByRole('dialog').getByRole('tabpanel');
  await expect(panel.getByRole('status')).toContainText('waiting');
  await panel.getByRole('button', { name: 'Sign out' }).click();
  const confirm = app.getByRole('dialog', { name: 'Sign out?' });
  await expect(confirm).toContainText("synced yet and will be lost");
  const settingsCopy = await confirm.getByText(/will be lost/).textContent();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await app.keyboard.press('Escape');
  await expect(app.getByRole('dialog', { name: 'Settings' })).toBeHidden();

  await app.getByRole('button', { name: 'Log out' }).click();
  const sidebarConfirm = app.getByRole('dialog', { name: 'Sign out?' });
  await expect(sidebarConfirm.getByText(/will be lost/)).toHaveText(settingsCopy!);
  await sidebarConfirm.getByRole('button', { name: 'Cancel' }).click();
});
