import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, openNote, typeInEditor } from '../support/actions';

// #158: closing a note compacts it and snapshots the pre-compaction state;
// Version history restores one, as a single undoable edit that persists.

test('restore an earlier version, undo it, and keep it across a reload', async ({ app }) => {
  // Snapshots are throttled to one per 5 minutes; a fake clock (installed before
  // the app boots, so its timers run normally) lets the test jump past that.
  await app.clock.install();
  await app.reload();
  await waitForAppReady(app);

  const title = `History ${Date.now()}`;
  const noteRow = app.getByRole('button').filter({ hasText: title });
  const closeTab = app.getByRole('button', { name: `Close ${title}` });
  const editor = activeEditor(app);

  await createNote(app, { title, body: 'first' });
  // A second write: destroy() only compacts (and so snapshots) a note with more
  // than one stored update, and one typing burst into a new note is one update.
  await typeInEditor(app, ' draft');
  await closeTab.click(); // compacts → snapshot of "first draft"

  await openNote(app, title);
  await editor.click();
  await app.keyboard.press('ControlOrMeta+a');
  await app.keyboard.type('second');
  await expect(noteRow.filter({ hasText: 'second' }).first()).toBeVisible();

  await app.clock.fastForward('06:00');
  await closeTab.click(); // compacts → snapshot of "second"
  await openNote(app, title);
  await expect(editor).toHaveText('second');

  await app.getByRole('button', { name: 'Version history' }).click();
  const history = app.getByRole('dialog', { name: 'Version history' });
  await expect(history.getByText('History is saved on this device only.')).toBeVisible();
  const firstVersion = history.getByRole('listitem').filter({ hasText: 'first' });
  await expect(firstVersion).toHaveCount(1);
  await test.info().attach('version-history-modal', { body: await app.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
  await firstVersion.getByRole('button', { name: 'Restore' }).click();
  await app
    .getByRole('dialog', { name: 'Restore this version?' })
    .getByRole('button', { name: 'Restore' })
    .click();

  await expect(history).toBeHidden();
  await expect(app.getByText('Version restored — press Cmd+Z to undo')).toBeVisible();
  await expect(editor).toHaveText('first draft');

  // Focus returns to the editor once the dialogs have closed, so the toast's
  // "press Cmd+Z" works from the keyboard.
  await expect(editor).toBeFocused();
  await app.keyboard.press('ControlOrMeta+z');
  await expect(editor).toHaveText('second');
  await app.keyboard.press('ControlOrMeta+Shift+z');
  await expect(editor).toHaveText('first draft');
  await expect(noteRow.filter({ hasText: 'first draft' }).first()).toBeVisible();

  await app.reload();
  await waitForAppReady(app);
  await expect(activeEditor(app)).toHaveText('first draft');
});
