import { test, expect, waitForAppReady } from '../fixtures';
import { createFolder, createNote, selectFolder, waitForNoteSaved } from '../support/actions';

// Sign-out wipes this device's database, and the wipe must reach IndexedDB before the page
// reloads: a COMMIT returns before PGlite writes it there. When it didn't, the next identity
// to sign in saw the previous one's folders and notes (#1060).

const SECOND_IDENTITY = 'e2e-second.homebase.test';

test("sign-out wipes the local database: after a reload the next identity sees none of the previous identity's notes", async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await createNote(app, { title: 'First identity note', body: 'Only for the first identity' });
  await createFolder(app, 'First identity folder');
  await selectFolder(app, 'First identity folder');
  await createNote(app, { title: 'First identity folder note', body: 'Also only for the first identity' });
  await waitForNoteSaved(app);

  await app.getByRole('button', { name: 'Log out' }).click();
  await app.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click();
  await expect(app).toHaveURL(/\/welcome$/);
  await app.reload();
  await expect(app.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  // Sign in as another identity, with fake credentials like e2e/fixtures/hermetic-auth.json.
  await app.evaluate((identity) => {
    localStorage.setItem('identity', identity);
    localStorage.setItem('BX0900', 'e2e-fake-auth-token-111111111111');
    localStorage.setItem('APSS', 'AQEBAQEBAQEBAQEBAQEBAQ==');
  }, SECOND_IDENTITY);
  await app.goto('/');
  await waitForAppReady(app);

  // "No notes yet" shows only once the note list has read the database.
  await expect(app.getByText('No notes yet')).toBeVisible();
  await expect(app.getByTestId('note-row')).toHaveCount(0);
  // A folder of the second identity shows once the folder list has read the database,
  // so the first identity's folder would show by then too.
  await createFolder(app, 'Second identity folder');
  await expect(app.getByText(/First identity/)).toHaveCount(0);
});
