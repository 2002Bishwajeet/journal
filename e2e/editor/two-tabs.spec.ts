import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, typeInEditor } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

test('typing in one tab shows up in another tab open on the same note', async ({ app }) => {
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
