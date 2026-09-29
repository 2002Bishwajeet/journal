import type { Page } from '@playwright/test';
import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, openNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #152: keystrokes are batched into one document_updates row per 300 ms window.
// These type WITHOUT typeInEditor's settle wait, so the last keystrokes are
// still inside an unflushed window when the note is closed / the page reloads.

async function typeNoSettle(page: Page, text: string): Promise<void> {
  await assertTestOrigin(page);
  const editor = activeEditor(page);
  await editor.click();
  await editor.pressSequentially(text);
}

test('typed sentence survives closing and reopening the note', async ({ app }) => {
  const title = `Batch close ${Date.now()}`;
  await createNote(app, { title, body: 'Start.' });

  await typeNoSettle(app, ' The quick brown fox jumps over the lazy dog.');
  await app.getByRole('button', { name: `Close ${title}` }).click();
  await expect(app.getByRole('button', { name: `Close ${title}` })).toHaveCount(0);

  await openNote(app, title);
  await expect(activeEditor(app)).toContainText('Start. The quick brown fox jumps over the lazy dog.');
});

// @quarantine: fails deterministically — the unflushed window is lost on reload.
// #152 makes the pagehide/visibilitychange flush best-effort only (an async
// PGlite/IndexedDB write during unload is not guaranteed to commit), and
// main loses the tail on an immediate reload too (see typeInEditor's comment).
test('typed sentence survives a reload right after typing @quarantine', async ({ app }) => {
  const title = `Batch reload ${Date.now()}`;
  await createNote(app, { title, body: 'Start.' });

  await typeNoSettle(app, ' Pack my box with five dozen liquor jugs.');
  await app.reload();
  await waitForAppReady(app);

  await expect(app.getByRole('button').filter({ hasText: title }).first()).toBeVisible();
  await expect(activeEditor(app)).toContainText('Start. Pack my box with five dozen liquor jugs.');
});
