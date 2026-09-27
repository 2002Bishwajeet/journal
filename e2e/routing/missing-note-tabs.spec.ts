import { test, expect, waitForAppReady } from '../fixtures';
import { createNote } from '../support/actions';

// Desktop tabs must never get stuck on "Note not found" (#188).

const BOGUS_ID = '00000000-0000-0000-0000-000000000000';

test('archiving the open note closes its tab', async ({ app }) => {
  await createNote(app, { title: 'Archive me', body: 'Soon archived' });
  const main = app.locator('#main-content');
  await expect(main.getByRole('button', { name: 'Archive me', exact: true })).toBeVisible();

  // The note-list row comes before the tab bar in the DOM.
  await app.getByRole('button').filter({ hasText: 'Archive me' }).first().click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Archive' }).click();

  await expect(main.getByRole('button', { name: 'Archive me', exact: true })).toHaveCount(0);
  await expect(main.getByText('Note not found')).toHaveCount(0);
  await expect(main.getByText('No notes open')).toBeVisible();
});

test('a missing note tab closes with one click and stays closed after reload', async ({ app }) => {
  await createNote(app, { title: 'Kept note', body: 'Still here' });
  const folderId = new URL(app.url()).pathname.split('/')[1];

  await app.goto(`/${folderId}/${BOGUS_ID}`);
  await waitForAppReady(app);
  const main = app.locator('#main-content');
  await expect(main.getByText('Note not found')).toBeVisible();

  await main.getByRole('button', { name: 'Close tab', exact: true }).click();

  await expect(main.getByRole('button', { name: 'Untitled', exact: true })).toHaveCount(0);
  await expect(app).not.toHaveURL(new RegExp(BOGUS_ID));

  await app.reload();
  await waitForAppReady(app);
  await expect(main.getByRole('button', { name: 'Kept note', exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Untitled', exact: true })).toHaveCount(0);
  await expect(main.getByText('Note not found')).toHaveCount(0);
});
