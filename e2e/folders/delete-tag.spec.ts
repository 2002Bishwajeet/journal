import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { createNote, openNote } from '../support/actions';

// #458: deleting a tag from the sidebar removes it from every note that has it.

async function addTag(page: Page, tag: string, expectedSidebarTags: number) {
  // The placeholder becomes "#" once the note has a tag; earlier tabs stay mounted (hidden).
  const tagInput = page.getByPlaceholder(/^(Add tags\.\.\.|#)$/).filter({ visible: true });
  await tagInput.fill(tag);
  await tagInput.press('Enter');
  // Wait for the tag to land before the next write: a quick second add overwrites the first.
  await expect(sidebarTags(page).getByRole('button')).toHaveCount(expectedSidebarTags);
}

function sidebarTags(page: Page) {
  return page.getByRole('complementary', { name: 'Sidebar' }).getByRole('navigation', { name: 'Tags' });
}

function visibleText(page: Page, text: string) {
  return page.getByText(text, { exact: true }).filter({ visible: true });
}

test('deleting a tag from the sidebar removes it from every note', async ({ app }) => {
  await createNote(app, { title: 'First tagged note', body: 'First body' });
  await addTag(app, 'obsolete', 1);
  await addTag(app, 'kept', 2);
  await createNote(app, { title: 'Second tagged note', body: 'Second body' });
  await addTag(app, 'obsolete', 2);

  // Filter by the tag, so deleting it must also clear the filter.
  const obsoleteTag = sidebarTags(app).getByRole('button', { name: /obsolete/ });
  await obsoleteTag.click();
  await expect(app).toHaveURL(/[?&]tag=obsolete/);

  // Escape cancels the confirm dialog and keeps the tag.
  await obsoleteTag.click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Delete tag' }).click();
  const dialog = app.getByRole('dialog');
  await expect(dialog).toContainText('Remove #obsolete from 2 notes? The notes themselves are kept.');
  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(obsoleteTag).toBeVisible();

  await obsoleteTag.click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Delete tag' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(obsoleteTag).toHaveCount(0);
  await expect(sidebarTags(app).getByRole('button', { name: /kept/ })).toBeVisible();
  await expect(app).not.toHaveURL(/[?&]tag=/);

  await openNote(app, 'First tagged note');
  await expect(visibleText(app, 'kept')).not.toHaveCount(0);
  await expect(visibleText(app, 'obsolete')).toHaveCount(0);

  await openNote(app, 'Second tagged note');
  await expect(app.getByPlaceholder('Add tags...').filter({ visible: true })).toBeVisible();
  await expect(visibleText(app, 'obsolete')).toHaveCount(0);
});
