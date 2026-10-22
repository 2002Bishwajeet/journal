import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import type JSZipType from 'jszip';

// jszip's CommonJS entry trips Playwright's ESM loader; its single-file bundle loads fine.
const JSZip = createRequire(import.meta.url)('jszip/dist/jszip.min.js') as typeof JSZipType;

// #592: notes with the same title export to distinct files and re-import cleanly.
test('same-title notes export as Same.md and "Same (2).md" and round-trip', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  const panel = dialog.getByRole('tabpanel');
  const input = dialog.locator('input[type="file"]');

  const md = (title: string, body: string) => ({
    name: `${title}-${body}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from(`---\ntitle: ${title}\n---\n${body}\n`),
  });
  await input.setInputFiles([md('Same', 'first'), md('Same', 'second'), md('Other', 'third')]);
  await expect(app.getByText('Successfully imported 3 notes')).toBeVisible();

  const download = app.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export All Notes' }).click();
  const path = await (await download).path();

  const zip = await JSZip.loadAsync(await readFile(path));
  const mdFiles = Object.keys(zip.files).filter((n) => n.endsWith('.md'));
  expect(mdFiles).toHaveLength(3);
  const names = mdFiles.map((n) => n.split('/').pop());
  expect(names).toContain('Same.md');
  expect(names).toContain('Same (2).md');

  await input.setInputFiles({
    name: 'export.zip',
    mimeType: 'application/zip',
    buffer: await readFile(path),
  });
  await expect(app.getByText('Successfully imported 3 notes').last()).toBeVisible();
});
