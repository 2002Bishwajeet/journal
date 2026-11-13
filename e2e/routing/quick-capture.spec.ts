import { test, expect, waitForAppReady } from '../fixtures';

// The desktop quick-capture window's route (#1014) works in a plain browser; only the
// global hotkey and the window itself are native.

test('/capture turns text into a note, first line as the title', async ({ app }) => {
  const title = `Captured ${Date.now()}`;
  await app.goto('/capture');
  const box = app.getByRole('textbox', { name: 'Quick note' });
  await expect(box).toBeFocused();

  await box.fill(`${title}\nthe body line`);
  await box.press('Control+Enter');
  await expect(box).toHaveValue('');

  await app.goto('/');
  await waitForAppReady(app);
  await app.getByRole('button', { name: 'Main' }).click();
  await expect(app.getByTestId('note-row').filter({ hasText: title })).toBeVisible();
});

test('/capture keeps the draft on Esc and does nothing for blank text', async ({ app }) => {
  await app.goto('/capture');
  const box = app.getByRole('textbox', { name: 'Quick note' });
  await box.fill('   \n ');
  await box.press('Control+Enter');
  await expect(box).toHaveValue('   \n ');

  await box.fill('A draft');
  await box.press('Escape');
  await expect(box).toHaveValue('A draft');
});
