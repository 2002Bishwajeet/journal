import { test, expect } from '../fixtures';
import { activeTitleInput, createNote, pasteHtml, waitForNoteSaved } from '../support/actions';

// Search opens a note at the word it matched (#1227), and Cmd/Ctrl+F finds in the open note from anywhere.

const paragraphs = (n: number, last: string) =>
  Array.from({ length: n }, (_, i) => `<p>Filler paragraph number ${i + 1} with some ordinary words.</p>`).join('') +
  `<p>${last}</p>`;

test('a body match opens the note with Find on that word, in view', async ({ app }) => {
  await createNote(app, { title: 'Long note', body: 'start' });
  await pasteHtml(app, paragraphs(60, 'The zorbleflux sits at the very end.'));
  await waitForNoteSaved(app);
  await createNote(app, { title: 'Other note', body: 'nothing here' });

  await app.keyboard.press('ControlOrMeta+k');
  const dialog = app.getByRole('dialog', { name: 'Search notes' });
  await dialog.getByPlaceholder('Search notes...').fill('zorbleflux');
  await expect(dialog.getByText('Long note')).toBeVisible();
  await app.keyboard.press('Enter');
  await expect(dialog).toBeHidden();

  const find = app.getByRole('textbox', { name: 'Find in note' });
  await expect(find).toHaveValue('zorbleflux');
  await expect(app.getByRole('search').getByText('1 of 1')).toBeVisible();
  await expect(app.locator('.search-highlight-current:visible')).toBeInViewport();

  // Esc closes the bar and returns focus to the note.
  await app.keyboard.press('Escape');
  await expect(find).toBeHidden();
  await expect(app.locator('.ProseMirror:visible')).toBeFocused();

  // Going back to the other note and forward again does not reopen the bar.
  await app.goBack();
  await app.goForward();
  await expect(activeTitleInput(app)).toHaveValue('Long note');
  await expect(find).toBeHidden();
});

test('a stemmed match opens Find on the word the note holds', async ({ app }) => {
  await createNote(app, { title: 'Weekly sync', body: 'Our quarterly meeting is on Friday.' });
  await waitForNoteSaved(app);
  await createNote(app, { title: 'Other note', body: 'nothing here' });

  await app.keyboard.press('ControlOrMeta+k');
  const dialog = app.getByRole('dialog', { name: 'Search notes' });
  await dialog.getByPlaceholder('Search notes...').fill('meetings');
  await expect(dialog.getByText('Weekly sync')).toBeVisible();
  await app.keyboard.press('Enter');

  await expect(app.getByRole('textbox', { name: 'Find in note' })).toHaveValue('meeting');
});

test('a title-only hit opens the note with no find bar', async ({ app }) => {
  await createNote(app, { title: 'Quixotic plans', body: 'nothing relevant' });
  await waitForNoteSaved(app);
  await createNote(app, { title: 'Other note', body: 'nothing here' });

  await app.keyboard.press('ControlOrMeta+k');
  const dialog = app.getByRole('dialog', { name: 'Search notes' });
  await dialog.getByPlaceholder('Search notes...').fill('Quixotic');
  await expect(dialog.getByText('Quixotic plans')).toBeVisible();
  await app.keyboard.press('Enter');

  await expect(activeTitleInput(app)).toHaveValue('Quixotic plans');
  await expect(app.getByRole('textbox', { name: 'Find in note' })).toBeHidden();
});

test('Ctrl/Cmd+F with focus in the title opens the find bar, and so does the toolbar button', async ({ app }) => {
  await createNote(app, { title: 'Find me', body: 'some text' });

  await activeTitleInput(app).focus();
  await app.keyboard.press('ControlOrMeta+f');
  await expect(app.getByRole('textbox', { name: 'Find in note' })).toBeFocused();

  await app.keyboard.press('Escape');
  await app.getByTitle('Find in note (⌘F)').click();
  await expect(app.getByRole('textbox', { name: 'Find in note' })).toBeFocused();
});
