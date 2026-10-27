import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createFolder, createNote, selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// Hold the restore back (after its index read) so the user can tap before it
// applies; the restore must then leave the user where they are.
test('a folder tapped during a slow session restore stays open', async ({ app }) => {
  const stamp = Date.now();
  const folderA = `Restore A ${stamp}`;
  const folderB = `Restore B ${stamp}`;
  await createFolder(app, folderA);
  await createFolder(app, folderB);
  await selectFolder(app, folderA);
  await createNote(app, { title: `Restore note ${stamp}`, body: 'Body.' });
  const [folderAId, noteId] = new URL(app.url()).pathname.split('/').filter(Boolean);
  expect(noteId).toBeTruthy();

  const page = await app.context().newPage();
  await page.addInitScript(
    ([a, n]) => {
      localStorage.setItem('journal-session-state', JSON.stringify({ lastFolderId: a, lastNoteId: n }));
      localStorage.setItem('e2e-session-restore-delay-ms', '3000');
    },
    [folderAId, noteId],
  );
  await page.goto('/');
  await assertTestOrigin(page);
  await waitForAppReady(page);

  await selectFolder(page, folderB);
  await expect(page).not.toHaveURL(new RegExp(`/${folderAId}`));
  const folderBUrl = page.url();

  // Wait past the delayed restore, then check it did not move the user.
  await page.waitForTimeout(3500);
  expect(page.url()).toBe(folderBUrl);
  await page.close();
});

// The restore itself still works: a cold start at / reopens the last note,
// whatever the app navigates during boot.
test('a cold start at / reopens the last note', async ({ app }) => {
  await createNote(app, { title: `Reopen note ${Date.now()}`, body: 'Body.' });
  const notePath = new URL(app.url()).pathname;
  await expect
    .poll(() => app.evaluate(() => JSON.parse(localStorage.getItem('journal-session-state') ?? '{}').lastNoteId))
    .toBe(notePath.split('/')[2]);

  await app.goto('/');
  await assertTestOrigin(app);
  await waitForAppReady(app);
  await expect(app).toHaveURL(new RegExp(`${notePath}$`));
  await expect(activeEditor(app)).toBeVisible();
});
