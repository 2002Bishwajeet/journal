import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { stubWebGPU } from '../support/webgpu';
import { finishLoad, queueReply, reloads, stubWebLLMWorker } from '../support/webllm-worker';
import { activeEditor, openNote, reloadNote, screenshotInBothThemes, selectFolder, waitForNoteSaved } from '../support/actions';

// The assistant proposes edits to the open note (#701). Each shows in the note as a preview with
// Accept and Reject, nothing changes until Accept, and one Cmd+Z undoes an accepted edit. A scripted
// engine worker stands in for the model, so the spec drives the real loop, tools and editor.

const NOTE = '---\ntitle: Weekend notes\n---\nFirst paragraph here.\n\nSecond paragraph here.\n\n- Buy milk\n- Call Sam';

async function importNote(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  await dialog.locator('input[type="file"]').setInputFiles([{ name: 'Weekend notes.md', mimeType: 'text/markdown', buffer: Buffer.from(NOTE) }]);
  await expect(page.getByText('Successfully imported 1 notes')).toBeVisible();
  await page.keyboard.press('Escape');
}

const readNote = { tool: 'read_open_note', args: {} };
const bold = (n: number) => ({ tool: 'format_text', args: { n, mark: 'bold', on: true } });

test('the assistant previews each edit in the note, and Accept, Reject and undo work from the keyboard too', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await stubWebLLMWorker(app);
  await stubWebGPU(app);

  await importNote(app);
  await selectFolder(app, 'Main');
  await openNote(app, 'Weekend notes');
  const editor = activeEditor(app);
  await expect(editor).toContainText('Second paragraph here.');

  await app.getByRole('button', { name: 'Open assistant' }).click();
  const panel = app.getByRole('region', { name: 'Assistant' });
  const box = panel.getByPlaceholder('Type a message or /help...');
  const download = app.getByRole('dialog', { name: /^Download / });
  const bar = editor.getByRole('group', { name: /^Review the assistant's edit/ });
  const strong = editor.locator('strong');

  /** Sends a request and queues the model's scripted turns. */
  async function ask(request: string, turns: object[]) {
    await box.fill(request);
    await box.press('Enter');
    await download.getByRole('button', { name: 'Continue' }).click();
    await assertTestOrigin(app);
    for (const turn of turns) await queueReply(app, turn);
  }

  // Reject: the preview shows in the note, the panel waits, and Reject leaves the note as it was.
  await box.fill('bold the second paragraph');
  await box.press('Enter');
  await download.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => reloads(app)).toHaveLength(1);
  await finishLoad(app, 'ok');
  await queueReply(app, readNote);
  await queueReply(app, bold(2));
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Make paragraph 2 bold');
  await expect(bar).toBeFocused();
  await expect(panel.getByText('Waiting for your OK in the note')).toBeVisible();
  await expect(editor.locator('.agent-edit-format')).toHaveText('Second paragraph here.');
  await expect(strong).toHaveCount(0);
  await screenshotInBothThemes(app, (theme) => `agent-edit-preview-${theme}-1280.png`);

  await queueReply(app, { answer: 'I left it as it is.' });
  await bar.getByRole('button', { name: 'Reject' }).click();
  await expect(panel.getByText('I left it as it is.')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(strong).toHaveCount(0);
  await expect(editor).toBeFocused();
  await panel.getByText('2 steps').click();
  await expect(panel.getByText('Rejected: Make paragraph 2 bold')).toBeVisible();

  // Accept: the second paragraph is bold, and one Cmd+Z removes the bold and nothing else.
  await ask('bold the second paragraph', [readNote, bold(2), { answer: 'Made it bold.' }]);
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Accept' }).click();
  await expect(panel.getByText('Made it bold.')).toBeVisible();
  await expect(strong).toHaveText('Second paragraph here.');
  await expect(editor).toBeFocused();

  await app.keyboard.press('ControlOrMeta+z');
  await expect(strong).toHaveCount(0);
  await expect(editor).toContainText('First paragraph here.');
  await expect(editor).toContainText('Second paragraph here.');
  await expect(editor.locator('li')).toHaveCount(2);

  // The accepted state is saved: redo it, wait for the save, reload.
  await app.keyboard.press('ControlOrMeta+Shift+z');
  await expect(strong).toHaveText('Second paragraph here.');
  await waitForNoteSaved(app);
  await reloadNote(app);
  await expect(activeEditor(app).locator('strong')).toHaveText('Second paragraph here.');
  await expect(activeEditor(app)).toContainText('First paragraph here.');
  await expect(activeEditor(app).locator('li')).toHaveCount(2);

  // Two proposals, answered one after the other: a heading "Plan" above the list.
  await app.getByRole('button', { name: 'Open assistant' }).click();
  await stubWebLLMWorker(app);
  await box.fill('add a heading Plan above the list');
  await box.press('Enter');
  await download.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => reloads(app)).toHaveLength(1);
  await finishLoad(app, 'ok');
  await queueReply(app, readNote);
  await queueReply(app, { tool: 'insert_paragraph', args: { after: 2, text: 'Plan' } });
  await expect(bar).toContainText('Add a paragraph after block 2');
  await expect(activeEditor(app).locator('.agent-edit-inserted-block')).toHaveText('Plan');
  await expect(activeEditor(app).locator('h2')).toHaveCount(0);
  await queueReply(app, { tool: 'set_block_type', args: { n: 3, type: 'h2' } });
  await queueReply(app, { answer: 'Added the heading.' });
  await bar.getByRole('button', { name: 'Accept' }).click();
  await expect(bar).toContainText('Turn paragraph 3 into h2');
  await bar.getByRole('button', { name: 'Accept' }).click();
  await expect(panel.getByText('Added the heading.')).toBeVisible();
  const heading = activeEditor(app).locator('h2');
  await expect(heading).toHaveText('Plan');
  await expect(activeEditor(app).locator('ul')).toHaveCount(1);
  expect((await orderOf(activeEditor(app))).slice(0, 4)).toEqual(['p', 'p', 'h2', 'ul']);

  // Keyboard only: Enter accepts, Escape rejects, and focus goes back to the editor.
  await ask('bold the first paragraph', [readNote, bold(1), { answer: 'Bold.' }]);
  await expect(bar).toBeFocused();
  await app.keyboard.press('Enter');
  await expect(panel.getByText('Bold.')).toBeVisible();
  await expect(activeEditor(app).locator('strong').first()).toHaveText('First paragraph here.');
  await expect(activeEditor(app)).toBeFocused();

  await ask('make the list a numbered list', [readNote, { tool: 'set_block_type', args: { n: 4, type: 'numbered' } }, { answer: 'Skipped.' }]);
  await expect(bar).toBeFocused();
  await app.keyboard.press('Escape');
  await expect(panel.getByText('Skipped.')).toBeVisible();
  await expect(activeEditor(app).locator('ul')).toHaveCount(1);
  await expect(activeEditor(app).locator('ol')).toHaveCount(0);
  await expect(activeEditor(app)).toBeFocused();
});

/** The tag names of the editor's top-level blocks, in order. */
function orderOf(editor: Locator): Promise<string[]> {
  return editor.evaluate((el) => [...el.children].map((child) => child.tagName.toLowerCase()));
}
