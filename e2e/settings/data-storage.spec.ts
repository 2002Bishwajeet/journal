import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createRequire } from 'node:module';
import type JSZipType from 'jszip';
import { makeSolidPng } from '../support/png';
import { activeEditor, activeTitleInput, createFolder, createNote, deleteFolder, openNote, selectFolder, waitForNoteSaved } from '../support/actions';
import { readFile } from 'node:fs/promises';

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

// #672: Export All Notes, then import that zip: the note comes back with the same folder, title, tag and callout.
// Not covered here: a pasted image. The hermetic app has no Homebase, so it stays a pending blob: image,
// and export does not write those. The unit round trip (importExportRoundTrip.test.ts) covers synced images.
test('export all, delete the folder, import the zip: the note comes back whole', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);

  const folder = `Round trip ${Date.now()}`;
  const title = `Trip "${Date.now()}"`;
  await createFolder(app, folder);
  await selectFolder(app, folder);
  await createNote(app, { title, body: 'Body line.' });
  const tagInput = app.getByPlaceholder(/^(Add tags\.\.\.|#)$/).filter({ visible: true });
  await tagInput.fill('kept-tag');
  await tagInput.press('Enter');
  await expect(app.getByText('kept-tag', { exact: true }).filter({ visible: true })).not.toHaveCount(0);
  await activeEditor(app).click();
  await activeEditor(app).press('ControlOrMeta+End');
  await activeEditor(app).press('Enter');
  await activeEditor(app).evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/plain', '');
    data.setData('text/html', '<div data-type="callout" data-variant="info"><p>Mind the gap.</p></div>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(activeEditor(app).locator('[data-type="callout"]')).toContainText('Mind the gap.');
  await waitForNoteSaved(app);

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  const download = app.waitForEvent('download');
  await dialog.getByRole('tabpanel').getByRole('button', { name: 'Export All Notes' }).click();
  const zipBytes = await readFile((await (await download).path())!);
  await app.keyboard.press('Escape');

  // Delete the original so the import has to recreate the folder and the note
  await deleteFolder(app, folder);
  await expect(app.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: folder, exact: true })).toHaveCount(0);

  await app.getByRole('button', { name: 'Settings' }).click();
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'export.zip', mimeType: 'application/zip', buffer: zipBytes });
  await expect(app.getByText(/Successfully imported \d+ notes/)).toBeVisible();
  await app.keyboard.press('Escape');

  // The deleted note's tab is still open; close it so the imported copy opens in its own
  await app.getByRole('button', { name: `Close ${title}` }).click();
  await selectFolder(app, folder);
  await openNote(app, title);
  await expect(activeTitleInput(app)).toHaveValue(title);
  await expect(app.getByText('kept-tag', { exact: true }).filter({ visible: true })).not.toHaveCount(0);
  await expect(activeEditor(app).locator('[data-type="callout"]')).toContainText('Mind the gap.');
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
