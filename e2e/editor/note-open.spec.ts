import { test, expect } from '../fixtures';
import { createNote, pasteHtml, selectFolder, waitForNoteSaved } from '../support/actions';
import { NOTE_FOLDER, measureOpen, reportOpens, setUpNoteOpen, type OpenSample } from '../support/noteOpen';

// A click on a note row opens the note at once: URL, selected row and editor within a frame or two.

test('clicking a note in a 100-note list opens it without a delay', async ({ app }) => {
  test.setTimeout(120_000);
  await app.setViewportSize({ width: 1280, height: 800 });
  const cdp = await setUpNoteOpen(app);
  await selectFolder(app, NOTE_FOLDER.name);
  const list = app.locator('[data-pane="note-list"]');
  await expect(list.getByText(`${NOTE_FOLDER.name} 1`, { exact: true })).toBeVisible();
  const samples: OpenSample[] = [];
  for (let i = 2; i <= 8; i++) {
    const title = `${NOTE_FOLDER.name} ${i}`;
    const row = list.getByTestId('note-row').filter({ has: app.getByText(title, { exact: true }) });
    samples.push(await measureOpen(app, cdp, row, title));
  }
  await reportOpens(samples, 'note-open.json');
});

// The same with ten long notes open in tabs, as a desktop day looks: a click on another
// note, and a click back on one already open.
test('clicking a note with ten long notes open in tabs opens it without a delay', async ({ app }) => {
  test.setTimeout(300_000);
  await app.setViewportSize({ width: 1280, height: 800 });
  const cdp = await setUpNoteOpen(app);
  await selectFolder(app, NOTE_FOLDER.name);
  const list = app.locator('[data-pane="note-list"]');
  const block = (i: number) =>
    `<h2>Section ${i}</h2><p>${'Some ordinary journal prose with <strong>bold</strong>, <em>italic</em> and <a href="https://example.com">a link</a>. '.repeat(4)}</p>` +
    `<ul><li>first point</li><li>second point</li><li><p>third</p><ul><li>nested</li></ul></li></ul>` +
    `<pre><code class="language-ts">const x${i} = ${i};\nconsole.log(x${i});</code></pre><blockquote><p>A quote ${i}</p></blockquote>`;
  const html = Array.from({ length: 60 }, (_, i) => block(i)).join('');
  for (let n = 1; n <= 10; n++) {
    await createNote(app, { title: `Long ${n}`, body: 'Start. ' });
    await pasteHtml(app, html);
    await waitForNoteSaved(app);
  }
  const row = (title: string) => list.getByTestId('note-row').filter({ has: app.getByText(title, { exact: true }) });
  const open = async (title: string) => measureOpen(app, cdp, row(title), title);
  const warm: OpenSample[] = [];
  for (const n of [3, 7, 2, 9, 5, 4, 8]) warm.push(await open(`Long ${n}`));
  await reportOpens(warm, 'note-open-tabs-warm.json');
  const cold: OpenSample[] = [];
  for (let i = 2; i <= 8; i++) cold.push(await open(`${NOTE_FOLDER.name} ${i}`));
  await reportOpens(cold, 'note-open-tabs-cold.json');
});
