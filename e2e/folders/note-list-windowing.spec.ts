import { test, expect } from '../fixtures';
import { activeEditor, selectFolder } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #154: the note list mounts 100 rows at a time and adds 100 more each time
// its end sentinel scrolls into view inside the Radix ScrollArea viewport.

// Loose .md files always import into the built-in "Main" folder.
const FOLDER = 'Main';
const COUNT = 250;
const pad = (i: number) => String(i).padStart(3, '0');

const seedFiles = () =>
  Array.from({ length: COUNT }, (_, k) => {
    const n = pad(k + 1);
    return {
      name: `note-${n}.md`,
      mimeType: 'text/markdown',
      buffer: Buffer.from(`---\ntitle: Note ${n}\n---\nBody ${n}\n`),
    };
  });

test('note list renders 100 rows at a time and resets on sort change', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await assertTestOrigin(app);

  await app.getByRole('button', { name: 'Settings' }).click();
  const dialog = app.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  const input = dialog.locator('input[type="file"]');
  // DataSection resets `value` right after calling handleImport, which empties
  // the live FileList before ImportService (dynamically imported) reads it —
  // every UI import currently imports 0 notes in Chromium. Make the reset a
  // no-op on this element so the real importer sees the files.
  await input.evaluate((el) => Object.defineProperty(el, 'value', { set() {} }));
  await input.setInputFiles(seedFiles());
  await expect(app.getByText(`Successfully imported ${COUNT} notes`)).toBeVisible({ timeout: 20_000 });
  await app.keyboard.press('Escape');

  await selectFolder(app, FOLDER);
  const rows = app.getByTestId('note-row');
  await expect(rows).toHaveCount(100);

  const viewport = app.locator('[data-radix-scroll-area-viewport]').filter({ has: rows.first() });
  const scrollTo = (top: 'start' | 'end') =>
    viewport.evaluate((el, t) => { el.scrollTop = t === 'end' ? el.scrollHeight : 0; }, top);

  await scrollTo('end');
  await expect(rows).toHaveCount(200);
  await scrollTo('end');
  await expect(rows).toHaveCount(COUNT);

  // From the top: left at the bottom, the shrunk list's sentinel is in view
  // again and immediately loads the next page.
  await scrollTo('start');
  await app.getByRole('button', { name: 'Sort notes' }).click();
  await app.getByRole('menuitem', { name: 'Title A-Z' }).click();
  await expect(rows).toHaveCount(100);

  // Title A-Z puts "Note 001" first.
  const first = rows.first().getByRole('button').filter({ hasText: 'Note 001' });
  await first.click({ button: 'right' });
  await expect(app.getByRole('menuitem', { name: 'Move to Trash' })).toBeVisible();
  await app.keyboard.press('Escape');

  await first.click();
  await expect(activeEditor(app)).toContainText('Body 001');

  const second = rows.nth(1).getByRole('button').filter({ hasText: 'Note 002' });
  await second.focus();
  await app.keyboard.press('Enter');
  await expect(activeEditor(app)).toContainText('Body 002');
});
