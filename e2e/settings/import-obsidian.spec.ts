import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createRequire } from 'node:module';
import type JSZipType from 'jszip';
import { makeSolidPng } from '../support/png';
import { activeEditor, activeTitleInput, foldersNav, openNote, selectFolder } from '../support/actions';

// jszip's CommonJS entry trips Playwright's ESM loader; its single-file bundle loads fine.
const JSZip = createRequire(import.meta.url)('jszip/dist/jszip.min.js') as typeof JSZipType;

// #593: a zipped Obsidian vault imports with working wiki links, embedded images,
// callouts and tags; the vault folder itself is stripped and .obsidian/.trash skipped.
test('zipped Obsidian vault: links, embeds, callouts and folders', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);

  const zip = new JSZip();
  zip.file('Vault/.obsidian/app.json', '{}');
  zip.file('Vault/.trash/Old.md', '# Trashed note');
  zip.file('Vault/A.md', [
    '---',
    'title: Alpha Note',
    '---',
    'Go to [[B|see beta]] or [[Missing]].',
    '',
    '![[pic.png]]',
    '',
    '> [!NOTE]',
    '> Plain note',
    '',
    '> [!warning] Careful',
    '> Mind the step',
    '',
    'An #idea here.',
  ].join('\n'));
  zip.file('Vault/Work/B.md', '---\ntitle: Beta Plan\n---\nBeta body');
  zip.file('Vault/Work/2024/C.md', '---\r\ntitle: Gamma Quarter\r\ntags:\r\n  - plan\r\n---\r\nGamma body\r\n');
  zip.file('Vault/attachments/pic.png', makeSolidPng(800, 600, [30, 120, 200]));

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'vault.zip',
    mimeType: 'application/zip',
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(app.getByText('Successfully imported 3 notes')).toBeVisible();
  await app.keyboard.press('Escape');

  // The vault's top-level folder becomes a Journal folder; the vault folder does not
  await expect(foldersNav(app).getByRole('button', { name: 'Work', exact: true })).toBeVisible();
  await expect(foldersNav(app).getByRole('button', { name: 'Vault', exact: true })).toHaveCount(0);
  await selectFolder(app, 'Work');
  await expect(app.getByRole('button').filter({ hasText: 'Beta Plan' }).first()).toBeVisible();
  await expect(app.getByRole('button').filter({ hasText: 'Gamma Quarter' }).first()).toBeVisible();

  await selectFolder(app, 'Main');
  await expect(app.getByRole('button').filter({ hasText: 'Trashed note' })).toHaveCount(0);
  await openNote(app, 'Alpha Note');
  const editor = activeEditor(app);

  // The embedded image renders from the queued upload
  const img = editor.locator('img[alt="pic.png"]');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  // Callouts render as callouts, the title in bold
  await expect(editor.locator('[data-type="callout"][data-variant="info"]')).toContainText('Plain note');
  const warning = editor.locator('[data-type="callout"][data-variant="warning"]');
  await expect(warning.locator('strong')).toHaveText('Careful');
  await expect(warning).toContainText('Mind the step');

  // An unresolved link is plain text
  await expect(editor.getByText('or Missing.')).toBeVisible();
  await expect(editor.locator('.note-link', { hasText: 'Missing' })).toHaveCount(0);

  // The wiki link opens the linked note (a note link shows its target's live title)
  await editor.locator('.note-link', { hasText: 'Beta Plan' }).click();
  await expect(activeTitleInput(app)).toHaveValue('Beta Plan');
});
