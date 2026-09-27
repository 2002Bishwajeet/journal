import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, activeTitleInput, createNote, openNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

test('a direct link to a note opens it', async ({ app }) => {
  const n1 = `Deep link N1 ${Date.now()}`;
  await createNote(app, { title: n1, body: 'N1 body.' });
  const n1Url = app.url();

  // N2 only needs to exist so the note list has more than one entry.
  const n2 = `Deep link N2 ${Date.now()}`;
  await createNote(app, { title: n2, body: 'N2 body.' });

  const fresh = await app.context().newPage();
  await fresh.goto(n1Url);
  await assertTestOrigin(fresh);
  await waitForAppReady(fresh);

  await expect(activeTitleInput(fresh)).toHaveValue(n1);
  await expect(activeEditor(fresh)).toContainText('N1 body.');

  await fresh.close();
});

test('back and forward navigate between notes', async ({ app }) => {
  const n1 = `Deep link back N1 ${Date.now()}`;
  await createNote(app, { title: n1, body: 'N1 body.' });

  const n2 = `Deep link back N2 ${Date.now()}`;
  await createNote(app, { title: n2, body: 'N2 body.' });

  await openNote(app, n1);
  await expect(activeTitleInput(app)).toHaveValue(n1);

  await openNote(app, n2);
  await expect(activeTitleInput(app)).toHaveValue(n2);

  await app.goBack();
  await expect(activeTitleInput(app)).toHaveValue(n1);

  await app.goForward();
  await expect(activeTitleInput(app)).toHaveValue(n2);
});

test('an unknown route lands on a valid screen instead of an error boundary', async ({ app }) => {
  await app.goto('/does-not-exist/xyz');
  await assertTestOrigin(app);
  await waitForAppReady(app);

  // A bogus folderId+noteId pair still matches the /:folderId/:noteId route
  // (isUnknownFolderRoute only redirects when noteId is absent), so the app
  // renders its own "note not found" fallback instead of crashing.
  await expect(app.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
  await expect(app.getByText('Note not found')).toBeVisible();
  // Desktop offers "Close tab" (#188); mobile keeps "Back to list".
  await expect(app.getByRole('button', { name: 'Close tab' })).toBeVisible();
});
