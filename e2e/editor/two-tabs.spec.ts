import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, typeInEditor } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// Real app bug, not a test flake: PGliteProvider.handleUpdate persists local
// Yjs updates but never calls documentBroadcast.notifyDocumentUpdated, so a
// second tab open on the same note never hears about a local (non-synced)
// edit. See https://github.com/2002Bishwajeet/journal/issues/256.
test('typing in one tab shows up in another tab open on the same note @quarantine', async ({ app }) => {
  test.fixme(true, 'https://github.com/2002Bishwajeet/journal/issues/256');

  const title = `Two tabs ${Date.now()}`;
  await createNote(app, { title, body: 'Shared note.' });
  const noteUrl = app.url();

  const pageB = await app.context().newPage();
  await pageB.goto(noteUrl);
  await assertTestOrigin(pageB);
  await waitForAppReady(pageB);

  await typeInEditor(app, ' From A.');
  await expect(activeEditor(pageB)).toContainText('From A.', { timeout: 5000 });

  await typeInEditor(pageB, ' From B.');
  await expect(activeEditor(app)).toContainText('From B.', { timeout: 5000 });

  await pageB.close();
});
