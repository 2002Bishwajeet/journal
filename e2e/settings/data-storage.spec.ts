import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createRequire } from 'node:module';
import type JSZipType from 'jszip';
import { makeSolidPng } from '../support/png';
import { activeEditor, openNote, selectFolder } from '../support/actions';

// jszip's CommonJS entry trips Playwright's ESM loader; its single-file bundle loads fine.
const JSZip = createRequire(import.meta.url)('jszip/dist/jszip.min.js') as typeof JSZipType;

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

// #533: a zip's relative images become the note's own (pending upload) images.
test('zip import turns relative images into note images', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);

  const folder = `Imported ${Date.now()}`;
  const zip = new JSZip();
  zip.file(`${folder}/Trip.md`, '# Trip\n\n![Red square](assets/red%20square.png)\n\n![Gone](assets/gone.png)\n');
  zip.file(`${folder}/assets/red square.png`, makeSolidPng(800, 600, [200, 30, 30]));

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'export.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(app.getByText('Successfully imported 1 notes')).toBeVisible();
  await app.keyboard.press('Escape');

  await selectFolder(app, folder);
  await openNote(app, 'Trip');
  const img = activeEditor(app).locator('img[alt="Red square"]');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  // The missing image stays readable as its alt text
  await expect(activeEditor(app).getByText('Gone')).toBeVisible();
  await expect(activeEditor(app).locator('img[alt="Gone"]')).toHaveCount(0);
});

// navigator.storage.persist() is browser-dependent, so either outcome is fine —
// but clicking Protect must visibly do one of them.
test('Protect either flips to Yes or explains the browser said no', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  const panel = dialog.getByRole('tabpanel');

  await expect(panel.getByText('Storage used')).toBeVisible();
  await expect(panel.getByText(/\d+(\.\d+)? (B|KB|MB|GB) of /)).toBeVisible();
  // The row: heading and status text in one column, the Protect button beside it.
  const row = panel.getByRole('heading', { name: 'Protected from browser cleanup' }).locator('../..');
  const protect = row.getByRole('button', { name: 'Protect' });
  if (await protect.isVisible()) {
    await protect.click();
    await expect(
      row.getByText('Yes', { exact: true }).or(app.getByText("Your browser didn't allow this. Data is still synced to your Homebase.")),
    ).toBeVisible();
  } else {
    await expect(row.getByText('Yes', { exact: true })).toBeVisible();
  }
});
