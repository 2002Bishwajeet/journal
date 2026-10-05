import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #457: Folders and Tags sections collapse from their headers; the choice survives a reload.

test('tags and folders sections collapse and stay collapsed after reload', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);
  await createNote(app, { title: 'Collapse me', body: 'Has a tag' });
  const tagInput = app.getByPlaceholder(/^(Add tags\.\.\.|#)$/);
  await tagInput.fill('work');
  await tagInput.press('Enter');

  const sidebar = app.getByRole('complementary', { name: 'Sidebar' });
  const tagsNav = sidebar.getByRole('navigation', { name: 'Tags' });
  const tagsHeader = sidebar.getByRole('button', { name: /^Tags/ });
  await expect(tagsNav.getByRole('button', { name: 'work' })).toBeVisible();
  await expect(tagsHeader).toHaveAttribute('aria-expanded', 'true');

  for (const scheme of ['light', 'dark'] as const) {
    await app.emulateMedia({ colorScheme: scheme });
    await expect(tagsNav).toBeVisible();
    await sidebar.screenshot({ path: test.info().outputPath(`sidebar-tags-expanded-${scheme}-desktop.png`), animations: 'disabled' });
  }

  await tagsNav.getByRole('button', { name: 'work' }).click();

  // Keyboard operable: Space toggles the focused header.
  await tagsHeader.focus();
  await app.keyboard.press('Space');
  await expect(tagsHeader).toHaveAttribute('aria-expanded', 'false');
  await expect(tagsNav).toBeHidden();
  // Collapsed header still shows the active tag.
  await expect(tagsHeader).toHaveText('Tags · #work');

  await sidebar.getByRole('button', { name: 'Folders' }).click();
  const foldersNav = sidebar.getByRole('navigation', { name: 'Folders' });
  await expect(foldersNav).toBeHidden();

  for (const scheme of ['light', 'dark'] as const) {
    await app.emulateMedia({ colorScheme: scheme });
    await sidebar.screenshot({ path: test.info().outputPath(`sidebar-tags-collapsed-${scheme}-desktop.png`), animations: 'disabled' });
  }

  await app.reload();
  await expect(sidebar.getByRole('button', { name: /^Tags/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar.getByRole('navigation', { name: 'Tags' })).toBeHidden();
  await expect(sidebar.getByRole('navigation', { name: 'Folders' })).toBeHidden();

  // Enter also toggles.
  await sidebar.getByRole('button', { name: /^Tags/ }).focus();
  await app.keyboard.press('Enter');
  await expect(sidebar.getByRole('navigation', { name: 'Tags' }).getByRole('button', { name: 'work' })).toBeVisible();
});
