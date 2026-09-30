import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// Settings: Data & storage shows real device storage info and imports/exports
// Markdown (#214).

test('storage info, .md and .txt import toasts, export downloads a zip', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  const panel = dialog.getByRole('tabpanel');

  await expect(panel.getByText('Storage used')).toBeVisible();

  // No workaround on the input's `value` setter: DataSection snapshots the
  // FileList before resetting the input, so the real importer sees the file.
  const input = dialog.locator('input[type="file"]');
  await input.setInputFiles({
    name: 'hello.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('---\ntitle: Hello\n---\nHello body\n'),
  });
  await expect(app.getByText('Successfully imported 1 notes')).toBeVisible();

  await input.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('plain text'),
  });
  await expect(app.getByText(/1 file couldn't be imported \(e\.g\. notes\.txt\)/)).toBeVisible();

  const download = app.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export All Notes' }).click();
  expect((await download).suggestedFilename()).toMatch(/^journal-export-.*\.zip$/);
});
