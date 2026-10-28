import { test, expect } from '../fixtures';
import { createNote, waitForNoteSaved } from '../support/actions';

// In a tag list, the list header's New creates a note in Main with that tag (#933).

test('New in a tag list tags the new note', async ({ app }) => {
  await createNote(app, { title: 'Work note', body: 'Tagged' });
  const main = new URL(app.url()).pathname.split('/')[1];
  await app.getByPlaceholder('Add tags...').fill('work');
  await app.getByPlaceholder('Add tags...').press('Enter');
  const tag = app.getByRole('navigation', { name: 'Tags' }).getByRole('button', { name: /work/ });
  await expect(tag).toBeVisible();
  await waitForNoteSaved(app);

  // Desktop's list header has no title, so the URL tells that the tag list is open.
  await tag.click();
  await expect(app).toHaveURL(/[?&]tag=work/);
  const rows = app.getByTestId('note-row');
  await expect(rows).toHaveCount(1);

  const before = app.url();
  await app.getByRole('button', { name: 'New', exact: true }).click();
  await app.waitForURL((url) => url.href !== before);
  expect(new URL(app.url()).pathname.split('/')[1]).toBe(main);
  await expect(app.getByTestId('note-row')).toHaveCount(2);
  // The new note carries `work`, so it is in the tag list too.
  await tag.click();
  await expect(app).toHaveURL(/[?&]tag=work/);
  await expect(rows).toHaveCount(2);
});
