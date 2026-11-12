import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createNote, selectFolder } from '../support/actions';

// Back after Move to Trash must not reopen the trashed note, and a trashed note's
// URL says "Note not found" instead of "Looking for this note…" forever
// (#111 iPhone test, https://github.com/2002Bishwajeet/journal/pull/111#issuecomment-6789944970).

const noteRow = (page: Page, title: string) => page.getByTestId('note-row').filter({ hasText: title });
const pathOf = (page: Page) => new URL(page.url()).pathname;

async function trashFromList(page: Page, title: string) {
  await noteRow(page, title).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('dialog', { name: 'Move to Trash?' }).getByRole('button', { name: 'Move to Trash' }).click();
  await expect(noteRow(page, title)).toHaveCount(0);
}

// The drive answers the trashed note's header, as Homebase does: the note is still there, in Trash.
async function answerTrashedHeader(page: Page, noteId: string) {
  await page.route('**/drive/query/specialized/cuid/header**', (route) =>
    route.fulfill({
      json: {
        fileId: 'trashed-remote-note',
        fileState: 'active',
        fileSystemType: 'Standard',
        fileMetadata: {
          isEncrypted: false,
          versionTag: 'trashed-version',
          created: 1,
          updated: 1,
          payloads: [],
          appData: { uniqueId: noteId, fileType: 605, dataType: 0, archivalStatus: 2, content: JSON.stringify({ title: 'Trashed' }) },
        },
        serverMetadata: { accessControlList: { requiredSecurityGroup: 'Owner' } },
        sharedSecretEncryptedKeyHeader: { iv: '', encryptedAesKey: '', encryptionVersion: 1, type: 11 },
      },
    }),
  );
}

test('Back after Move to Trash does not reopen the trashed note', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await selectFolder(app, 'Main');
  const title = `Trash back ${Date.now()}`;
  await createNote(app, { title, body: 'Going to Trash' });
  const notePath = pathOf(app);

  await trashFromList(app, title);
  await expect.poll(() => pathOf(app)).not.toBe(notePath);
  await answerTrashedHeader(app, notePath.split('/')[2]);

  await app.goBack();
  await expect.poll(() => pathOf(app)).not.toBe(notePath);
  await expect(app.getByText('Looking for this note…')).toHaveCount(0);
});

test('a link to a trashed note says "Note not found", not "Looking for this note…"', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await selectFolder(app, 'Main');
  const title = `Trash link ${Date.now()}`;
  await createNote(app, { title, body: 'Going to Trash' });
  const notePath = pathOf(app);

  await trashFromList(app, title);
  // Trash leaves the open note once the trash is done: a link followed before then is undone by it
  await expect.poll(() => pathOf(app)).not.toBe(notePath);
  await answerTrashedHeader(app, notePath.split('/')[2]);

  // An in-app navigation to the note, as a link inside another note would do.
  await app.evaluate((path) => {
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, notePath);
  await expect.poll(() => pathOf(app)).toBe(notePath);
  const main = app.locator('#main-content');
  await expect(main.getByText('Note not found')).toBeVisible();
  await expect(main.getByText('Looking for this note…')).toHaveCount(0);
});
