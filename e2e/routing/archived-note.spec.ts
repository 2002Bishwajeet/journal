import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, selectFolder } from '../support/actions';

// The editor opens only active notes: the Archive view lists archived notes with
// Unarchive and Move to Trash, and has no way to open one. Once unarchived, the
// note opens with its content. A link to an archived note says "Note not found"
// (not "Looking for this note…" forever).

const noteRow = (page: Page, title: string) => page.getByTestId('note-row').filter({ hasText: title });
const archivedRow = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });
const pathOf = (page: Page) => new URL(page.url()).pathname;

async function archiveFromList(page: Page, title: string) {
  await noteRow(page, title).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(noteRow(page, title)).toHaveCount(0);
}

test('an archived note is listed in Archive, opens again once unarchived, and a link to it says not found', async ({ app }) => {
  test.setTimeout(60_000);
  await app.setViewportSize({ width: 1280, height: 800 });
  await selectFolder(app, 'Main');
  const title = `Archived ${Date.now()}`;
  await createNote(app, { title, body: 'Kept in the archive' });
  const notePath = pathOf(app);
  const noteId = notePath.split('/')[2];

  await archiveFromList(app, title);
  await app.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Archive/ }).click();
  await expect(archivedRow(app, title)).toBeVisible();
  await archivedRow(app, title).getByRole('button', { name: 'Unarchive note' }).click();
  await expect(archivedRow(app, title)).toHaveCount(0);

  await selectFolder(app, 'Main');
  await noteRow(app, title).click();
  await expect(activeEditor(app)).toContainText('Kept in the archive');

  // Archived again, a link to it says "Note not found". The drive still has it, archived.
  await archiveFromList(app, title);
  await app.route('**/drive/query/specialized/cuid/header**', (route) =>
    route.fulfill({
      json: {
        fileId: 'archived-remote-note',
        fileState: 'active',
        fileSystemType: 'Standard',
        fileMetadata: {
          isEncrypted: false,
          versionTag: 'archived-version',
          created: 1,
          updated: 1,
          payloads: [],
          appData: { uniqueId: noteId, fileType: 605, dataType: 0, archivalStatus: 1, content: JSON.stringify({ title }) },
        },
        serverMetadata: { accessControlList: { requiredSecurityGroup: 'Owner' } },
        sharedSecretEncryptedKeyHeader: { iv: '', encryptedAesKey: '', encryptionVersion: 1, type: 11 },
      },
    }),
  );
  await app.evaluate((path) => {
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  }, notePath);
  const main = app.locator('#main-content');
  await expect(main.getByText('Note not found')).toBeVisible();
  await expect(main.getByText('Looking for this note…')).toHaveCount(0);
});
