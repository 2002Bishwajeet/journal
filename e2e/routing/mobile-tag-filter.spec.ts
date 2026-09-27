import { test, expect, waitForAppReady } from '../fixtures';
import { createNote } from '../support/actions';

// On mobile, tapping a tag shows that tag's notes, not just a highlight (#190).

test('tapping a tag on mobile opens its note list', async ({ app }) => {
  await createNote(app, { title: 'Tagged note', body: 'Has a tag' });
  await app.getByPlaceholder('Add tags...').fill('routing');
  await app.getByPlaceholder('Add tags...').press('Enter');
  // Wait for the debounced title/body writes before reloading.
  await app.waitForTimeout(1000);

  // Forget the last note so the cold start below stays on the sidebar instead
  // of session restore reopening it.
  await app.evaluate(() => localStorage.removeItem('journal-session-state'));
  await app.setViewportSize({ width: 390, height: 844 });
  await app.goto('/');
  await waitForAppReady(app);

  const sidebar = app.getByRole('complementary', { name: 'Sidebar' });
  await sidebar.getByRole('navigation', { name: 'Tags' }).getByRole('button', { name: /routing/ }).click();

  await expect(app.getByRole('heading', { name: '#routing' })).toBeVisible();
  await expect(sidebar).toBeHidden();
  await app.getByRole('button').filter({ hasText: 'Tagged note' }).first().click();
  await expect(app.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
});
