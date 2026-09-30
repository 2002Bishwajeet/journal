import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';

// With more tags than fit, the folders/tags list scrolls and the footer
// (Archive, Trash, Settings, Log out) stays on screen.

test('sidebar footer stays reachable with many tags', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 600 });
  await createNote(app, { title: 'Many tags', body: 'Has many tags' });
  // The placeholder becomes "#" once the note has a tag.
  const tagInput = app.getByPlaceholder(/^(Add tags\.\.\.|#)$/);
  const sidebar = app.getByRole('complementary', { name: 'Sidebar' });
  const sidebarTags = sidebar.getByRole('navigation', { name: 'Tags' }).getByRole('button');
  for (let i = 0; i < 14; i++) {
    await tagInput.fill(`tag-${i}`);
    await tagInput.press('Enter');
    // Wait for the tag to land before adding the next: a quick second add overwrites the first.
    await expect(sidebarTags).toHaveCount(i + 1);
  }
  const lastTag = sidebarTags.filter({ hasText: 'tag-13' });
  await expect(sidebar.getByRole('button', { name: 'Log out' })).toBeInViewport();

  await lastTag.scrollIntoViewIfNeeded();
  await expect(lastTag).toBeInViewport();
});
