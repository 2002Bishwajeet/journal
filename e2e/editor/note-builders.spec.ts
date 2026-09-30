import { execFileSync } from 'node:child_process';
import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';

// #232 moved the Yjs doc loader and note-content builders out of useNotes.ts.
// Export reads a note back through that loader (extractMarkdownFromYjs), so it
// is the one moved path reachable from the UI: the daily-note ("Today") and
// template entry points are hidden behind FEATURES.dailyNotes / .templates
// (src/lib/featureFlags.ts) and covered by dailyNotes.test.ts and
// templateContent.test.ts instead.
test('exported zip contains the note markdown with its content intact', async ({ app }) => {
  const title = `Export ${Date.now()}`;
  await createNote(app, { title, body: 'Exported paragraph one.' });

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data' }).click();

  const downloadPromise = app.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export All Notes' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^journal-export-.*\.zip$/);

  // `unzip` rather than jszip: jszip's CJS build crashes Playwright's loader.
  const md = execFileSync('unzip', ['-p', await download.path(), `${title}.md`], { encoding: 'utf8' });
  expect(md).toContain(`title: "${title}"`);
  expect(md).toContain('Exported paragraph one.');
});
