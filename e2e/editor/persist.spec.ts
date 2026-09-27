import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, typeInEditor } from '../support/actions';

test('created note persists across a reload', async ({ app }) => {
  const title = `Persist ${Date.now()}`;
  await createNote(app, { title, body: 'First paragraph.\nSecond paragraph.' });

  await app.reload();
  await waitForAppReady(app);

  await expect(app.getByRole('button').filter({ hasText: title }).first()).toBeVisible();
  await expect(activeEditor(app)).toContainText('First paragraph.');
  await expect(activeEditor(app)).toContainText('Second paragraph.');
});

test('edited note survives a reload', async ({ app }) => {
  const title = `Persist edit ${Date.now()}`;
  await createNote(app, { title, body: 'Original text.' });

  await typeInEditor(app, ' Appended text.');
  await expect(activeEditor(app)).toContainText('Appended text.');

  await app.reload();
  await waitForAppReady(app);

  await expect(app.getByRole('button').filter({ hasText: title }).first()).toBeVisible();
  await expect(activeEditor(app)).toContainText('Original text.');
  await expect(activeEditor(app)).toContainText('Appended text.');
});
