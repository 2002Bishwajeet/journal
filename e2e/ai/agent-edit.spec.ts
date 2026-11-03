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

const bold = (n: number) => ({ tool: 'format_text', args: { n, mark: 'bold', on: true } });

test('the assistant previews each edit in the note, and Accept, Reject and undo work from the keyboard too', async ({ app }) => {
  test.slow();
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
  await queueReply(app, bold(2));
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Make paragraph 2 bold');
  await expect(bar).toBeFocused();
  await expect(panel.getByText('Waiting for your OK in the note')).toBeVisible();
  // The preview shows the text bold, but the note itself has no bold yet.
  await expect(editor.locator('strong.agent-edit-format')).toHaveText('Second paragraph here.');
  await expect(editor.locator('strong:not(.agent-edit-format)')).toHaveCount(0);
  // The panel floats over the right of the note at 1280px: the bar and the block outline stay left of it.
  const panelLeft = (await panel.boundingBox())!.x;
  await expect.poll(async () => (await bar.boundingBox())!.x + (await bar.boundingBox())!.width).toBeLessThanOrEqual(panelLeft);
  await expect(bar.getByText('Make paragraph 2 bold')).toBeVisible();
  const outlineRight = await editor.locator('p.agent-edit-block').evaluate((el) => el.getBoundingClientRect().right - parseFloat(getComputedStyle(el, '::after').right));
  expect(outlineRight).toBeLessThanOrEqual(panelLeft);
  await screenshotInBothThemes(app, (theme) => `agent-edit-preview-${theme}-1280.png`);

  await queueReply(app, { answer: 'I left it as it is.' });
  await bar.getByRole('button', { name: 'Reject' }).click();
  await expect(panel.getByText('I left it as it is.')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await expect(strong).toHaveCount(0);
  await expect(editor).toBeFocused();
  await panel.getByText('1 step', { exact: true }).click();
  await expect(panel.getByText('Rejected: Make paragraph 2 bold')).toBeVisible();

  // Accept: the second paragraph is bold, and one Cmd+Z removes the bold and nothing else.
  await ask('bold the second paragraph', [bold(2), { answer: 'Made it bold.' }]);
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

  // Two proposals, answered one after the other: a line "Plan" above the list, then a longer one.
  await app.getByRole('button', { name: 'Open assistant' }).click();
  await stubWebLLMWorker(app);
  await box.fill('add a line Plan above the list');
  await box.press('Enter');
  await download.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => reloads(app)).toHaveLength(1);
  await finishLoad(app, 'ok');
  await queueReply(app, { tool: 'insert_paragraph', args: { after: 2, text: 'Plan' } });
  await expect(bar).toContainText('Add a paragraph after block 2');
  await expect(activeEditor(app).locator('.agent-edit-inserted-block')).toHaveText('Plan');
  await screenshotInBothThemes(app, (theme) => `agent-edit-insert-${theme}-1280.png`);
  await queueReply(app, { tool: 'replace_text', args: { n: 3, find: 'Plan', replace: 'Plan ahead' } });
  await queueReply(app, { answer: 'Added the line.' });
  await bar.getByRole('button', { name: 'Accept' }).click();
  await expect(bar).toContainText('Replace "Plan" with "Plan ahead"');
  await bar.getByRole('button', { name: 'Accept' }).click();
  await expect(panel.getByText('Added the line.')).toBeVisible();
  await expect(activeEditor(app).getByText('Plan ahead', { exact: true })).toBeVisible();
  await expect(activeEditor(app).locator('ul')).toHaveCount(1);
  expect((await orderOf(activeEditor(app))).slice(0, 4)).toEqual(['p', 'p', 'p', 'ul']);

  // Keyboard only: Enter accepts, Escape rejects, and focus goes back to the editor.
  await ask('bold the first paragraph', [bold(1), { answer: 'Bold.' }]);
  await expect(bar).toBeFocused();
  await app.keyboard.press('Enter');
  await expect(panel.getByText('Bold.')).toBeVisible();
  await expect(activeEditor(app).locator('strong').first()).toHaveText('First paragraph here.');
  await expect(activeEditor(app)).toBeFocused();

  // A removal: the old words are struck through and the new ones underlined. Rejected.
  await ask('say Next instead of Second', [{ tool: 'replace_text', args: { n: 2, find: 'Second', replace: 'Next' } }, { answer: 'Kept it.' }]);
  await expect(activeEditor(app).locator('.agent-edit-removed')).toHaveText('Second');
  await expect(activeEditor(app).locator('.agent-edit-inserted')).toHaveText('Next');
  await screenshotInBothThemes(app, (theme) => `agent-edit-replace-${theme}-1280.png`);
  await bar.getByRole('button', { name: 'Reject' }).click();
  await expect(panel.getByText('Kept it.')).toBeVisible();
  await expect(activeEditor(app)).toContainText('Second paragraph here.');

  await ask('add a line Top above everything', [{ tool: 'insert_paragraph', args: { after: 0, text: 'Top' } }, { answer: 'Skipped.' }]);
  await expect(bar).toBeFocused();
  await app.keyboard.press('Escape');
  await expect(panel.getByText('Skipped.')).toBeVisible();
  await expect(activeEditor(app).locator('ul')).toHaveCount(1);
  await expect(activeEditor(app).getByText('Top', { exact: true })).toHaveCount(0);
  await expect(activeEditor(app)).toBeFocused();
});

// The assistant isn't offered below 768px, so 768px is the narrowest width a preview can show at.
// There the panel fills the screen: close it to see the preview in the note.
test('the preview fits the narrowest width with the assistant', async ({ app }) => {
  await stubWebLLMWorker(app);
  await stubWebGPU(app);
  await importNote(app);
  await selectFolder(app, 'Main');
  // Resize after: a tablet keeps the folders and Settings in an overlay (#832).
  await app.setViewportSize({ width: 768, height: 1024 });
  await openNote(app, 'Weekend notes');
  const editor = activeEditor(app);
  await expect(editor).toContainText('Second paragraph here.');

  await app.getByRole('button', { name: 'Open assistant' }).click();
  const panel = app.getByRole('region', { name: 'Assistant' });
  const box = panel.getByPlaceholder('Type a message or /help...');
  await box.fill('say Next instead of Second');
  await box.press('Enter');
  await app.getByRole('dialog', { name: /^Download / }).getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => reloads(app)).toHaveLength(1);
  await finishLoad(app, 'ok');
  await queueReply(app, { tool: 'replace_text', args: { n: 2, find: 'Second', replace: 'Next' } });
  await expect(panel.getByText('Waiting for your OK in the note')).toBeVisible();
  await app.getByRole('button', { name: 'Close assistant' }).click();

  const bar = editor.getByRole('group', { name: /^Review the assistant's edit/ });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Reject' })).toBeInViewport({ ratio: 1 });
  await expect(editor.locator('.agent-edit-removed')).toHaveText('Second');
  await screenshotInBothThemes(app, (theme) => `agent-edit-replace-${theme}-768.png`);
  await bar.getByRole('button', { name: 'Reject' }).click();
  await expect(bar).toHaveCount(0);
  await expect(editor).toContainText('Second paragraph here.');
});

/** The tag names of the editor's top-level blocks, in order. */
function orderOf(editor: Locator): Promise<string[]> {
  return editor.evaluate((el) => [...el.children].map((child) => child.tagName.toLowerCase()));
}
