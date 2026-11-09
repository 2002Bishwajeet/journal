import { test, expect } from '../fixtures';
import { activeEditor, createNote, pasteHtml } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #520: Export to PDF opens the print dialog on the note alone ("static print"): light
// theme, toggles open, live blocks as they are drawn. The dialog is stubbed; the PDF
// Chromium would save is made with page.pdf() while the page is still set up for it.

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The note's blocks as pasted HTML, through the editor's real paste path. */
const BODY = [
  '<div data-type="callout" data-variant="info"><p>A callout keeps its colour.</p></div>',
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Book the train</p></li><li data-type="taskItem" data-checked="true"><p>Pack</p></li></ul>',
  '<details><summary>Hidden part</summary><p>Text inside the toggle.</p></details>',
  ...[
    ['mermaid', 'flowchart LR\n  A[Plan] --> B[Go]'],
    ['svg', '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect width="120" height="40" rx="6" fill="#4f7cff"/></svg>'],
    [
      'html',
      '<p id="out">clicked 0</p><button id="add">Add</button>\n' +
        "<script>let n = 0; document.getElementById('add').onclick = () => { n += 1; document.getElementById('out').textContent = 'clicked ' + n; };</script>",
    ],
  ].map(([language, code]) => `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`),
].join('');

test('Export to PDF prints the note alone, light, with toggles open, and puts the screen back', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 900 });
  await app.emulateMedia({ colorScheme: 'dark' });
  const title = `PDF export ${Date.now()}`;
  await createNote(app, { title, body: 'Before the blocks.' });
  await app.keyboard.press('Enter');
  await pasteHtml(app, BODY);

  const editor = activeEditor(app);
  const html = editor.locator('[data-live-block="html"]');
  await expect(html.frameLocator('iframe[title="HTML preview"]').locator('#out')).toHaveText('clicked 0');
  await editor.getByText('Text inside the toggle.').waitFor();
  await app.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(editor.getByText('Text inside the toggle.')).toBeHidden();

  // The print dialog would block the test: record the call instead (afterprint then never fires).
  await assertTestOrigin(app);
  await app.evaluate(() => {
    window.print = () => document.documentElement.setAttribute('data-test-printed', '');
  });

  await app.getByTestId('note-row').filter({ hasText: title }).click({ button: 'right' });
  await app.getByRole('menuitem', { name: 'Export to PDF' }).click();

  const root = app.locator('html');
  await expect(root).toHaveAttribute('data-test-printed', '', { timeout: 15_000 });
  await expect(root).toHaveClass(/\blight\b/);
  await expect(editor.getByText('Text inside the toggle.')).toBeVisible();
  expect(await app.title()).toBe(title);

  // What prints: the note and nothing of the app around it.
  await app.emulateMedia({ media: 'print' });
  await expect(app.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await expect(app.getByTestId('note-row').first()).toBeHidden();
  await expect(app.getByLabel('Note title')).toBeHidden();
  await expect(editor.getByText('Before the blocks.')).toBeVisible();
  await expect(html.locator('iframe')).toBeVisible();
  await app.screenshot({ path: test.info().outputPath('pdf-export-print-media.png'), fullPage: true });
  const pdf = await app.pdf({ path: test.info().outputPath('pdf-export.pdf'), format: 'A4' });
  expect(pdf.byteLength).toBeGreaterThan(10_000);

  // The dialog closes: the dark theme, the collapsed toggle and the title come back.
  await app.emulateMedia({ media: 'screen' });
  await app.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(root).toHaveClass(/\bdark\b/);
  await expect(editor.getByText('Text inside the toggle.')).toBeHidden();
  await expect(app.locator('[data-print-path], [data-print-root]')).toHaveCount(0);
  expect(await app.title()).not.toBe(title);
});
