import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createRequire } from 'node:module';
import type JSZipType from 'jszip';
import { makeSolidPng } from '../support/png';
import type { Page } from '@playwright/test';
import { activeEditor, activeTitleInput, foldersNav, selectFolder } from '../support/actions';

// jszip's CommonJS entry trips Playwright's ESM loader; its single-file bundle loads fine.
const JSZip = createRequire(import.meta.url)('jszip/dist/jszip.min.js') as typeof JSZipType;

const ID = '0123456789abcdef0123456789abcdef';
const ID2 = 'fedcba9876543210fedcba9876543210';

// A note of the list (named by its title, then preview), not the folder of the same name
const openNote = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^${title} `) }).first().click();

// #595: a Notion "Markdown & CSV" export, wrapped as a zip of part zips, imports with
// clean names, working links between pages, its images and each database as a table.
test('Notion export: clean names, page links, images and database tables', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);

  const part = new JSZip();
  part.file(`Project ${ID}.md`, [
    '# Project',
    '',
    `Read the [Spec](Project%20${ID}/Spec%20${ID2}.md).`,
    '',
    `![diagram.png](Project%20${ID}/diagram.png)`,
  ].join('\n'));
  part.file(`Project ${ID}/Spec ${ID2}.md`, '# Spec\n\nSpec body');
  part.file(`Project ${ID}/diagram.png`, makeSolidPng(800, 600, [30, 120, 200]));
  part.file(`Tasks ${ID2}.csv`, '﻿Name,Status\nWrite,Done\n');
  part.file(`Tasks ${ID2}_all.csv`, '﻿Name,Status,Notes\nWrite,Done,"a, b"\nShip,Todo,"say ""go"""\n');
  part.file(`Tasks ${ID2}/Write ${ID}.md`, '# Write\n\nStatus: Done');
  part.file(`Tasks ${ID2}/Ship ${ID}.md`, '# Ship\n\nStatus: Todo');
  const outer = new JSZip();
  outer.file(`Export-${ID}-Part-1.zip`, await part.generateAsync({ type: 'nodebuffer' }));

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: `${ID}.zip`,
    mimeType: 'application/zip',
    buffer: await outer.generateAsync({ type: 'nodebuffer' }),
  });
  await expect(app.getByText('Successfully imported 5 notes and created 2 folders.')).toBeVisible();
  await app.keyboard.press('Escape');

  // Folders take the page and database names, without Notion's ids
  const nav = foldersNav(app);
  await expect(nav.getByRole('button', { name: 'Project', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: /[0-9a-f]{32}/ })).toHaveCount(0);

  await selectFolder(app, 'Main');
  await openNote(app, 'Project');
  const editor = activeEditor(app);
  // The page's own `# Project` isn't repeated in the body
  await expect(editor.locator('h1')).toHaveCount(0);
  const img = editor.locator('img[alt="diagram.png"]');
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  await editor.locator('.note-link', { hasText: 'Spec' }).click();
  await expect(activeTitleInput(app)).toHaveValue('Spec');
  await expect(activeEditor(app).getByText('Spec body')).toBeVisible();

  // The database: one note, a table of every row, first cells linked to the row pages
  await selectFolder(app, 'Main');
  await openNote(app, 'Tasks');
  const table = activeEditor(app).locator('table');
  await expect(table.locator('tr')).toHaveCount(3);
  await expect(table.locator('tr').nth(0)).toContainText('Notes');
  await expect(table.locator('tr').nth(1)).toContainText('a, b');
  await expect(table.locator('tr').nth(2)).toContainText('say "go"');
  await table.locator('.note-link', { hasText: 'Ship' }).click();
  await expect(activeTitleInput(app)).toHaveValue('Ship');
  await expect(activeEditor(app).getByText('Status: Todo')).toBeVisible();

  // Row pages are notes of the database's folder
  await selectFolder(app, 'Tasks');
  await expect(app.getByRole('button').filter({ hasText: 'Write' }).first()).toBeVisible();
});
