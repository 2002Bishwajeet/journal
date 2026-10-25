import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { stubWebGPU } from '../support/webgpu';
import { finishLoad, queueReply, reloads, stubWebLLMWorker } from '../support/webllm-worker';
import { activeEditor, openNote, screenshotInBothThemes, selectFolder } from '../support/actions';

// The AI menu's rewrite shows its result in the note like the assistant's edits do (#703): a preview
// with Accept and Reject, and one Cmd+Z restores the text. /summarize opens the assistant. A scripted
// engine worker stands in for the model.

const NOTE = '---\ntitle: Weekend notes\n---\nThis is a very long and wordy sentence that says little.\n\nSecond paragraph here.';

async function importNote(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  await dialog.locator('input[type="file"]').setInputFiles([{ name: 'Weekend notes.md', mimeType: 'text/markdown', buffer: Buffer.from(NOTE) }]);
  await expect(page.getByText('Successfully imported 1 notes')).toBeVisible();
  await page.keyboard.press('Escape');
}

test('the AI menu previews its rewrite in the note, and Accept and one undo work', async ({ app }) => {
  test.slow();
  await app.setViewportSize({ width: 1280, height: 800 });
  await stubWebLLMWorker(app);
  await stubWebGPU(app);
  await importNote(app);
  await selectFolder(app, 'Main');
  await openNote(app, 'Weekend notes');
  const editor = activeEditor(app);
  await expect(editor).toContainText('Second paragraph here.');

  // Select the first paragraph's sentence. ProseMirror's 20 ms focus timer can undo a key sent right
  // after the click (the menu then sees no selection, or only part of it), so retry until the
  // editor's own selection is the whole sentence.
  type View = { editor: { state: { doc: { textBetween: (from: number, to: number) => string }; selection: { from: number; to: number } } } };
  const selectedText = () =>
    editor.evaluate((el) => {
      const { state } = (el as unknown as View).editor;
      return state.doc.textBetween(state.selection.from, state.selection.to);
    });
  const selectFirstParagraph = async () => {
    await expect(async () => {
      await editor.locator('p').first().click();
      await app.keyboard.press('Home');
      await app.keyboard.press('Shift+End');
      await expect.poll(selectedText, { timeout: 1000 }).toBe('This is a very long and wordy sentence that says little.');
    }).toPass();
  };
  await selectFirstParagraph();
  await assertTestOrigin(app);

  // The menu loads the editor model first.
  await app.getByRole('button', { name: 'AI Actions' }).click();
  await app.getByRole('menuitem', { name: 'Enable AI' }).click();
  await expect.poll(() => reloads(app)).toHaveLength(1);
  await finishLoad(app, 'ok');
  await expect(app.getByRole('button', { name: 'AI Actions' })).toBeEnabled();
  await selectFirstParagraph();
  await app.getByRole('button', { name: 'AI Actions' }).click();
  await app.getByRole('menuitem', { name: 'Concise' }).click();
  await queueReply(app, 'A short sentence.');

  const bar = editor.getByRole('group', { name: /^Review the assistant's edit/ });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Rewrite the selected text (Concise)');
  await expect(editor.locator('.agent-edit-inserted')).toHaveText('A short sentence.');
  await expect(editor).toContainText('This is a very long and wordy sentence');
  await screenshotInBothThemes(app, (theme) => `editor-rewrite-preview-${theme}-1280.png`);

  await bar.getByRole('button', { name: 'Accept' }).click();
  await expect(bar).toHaveCount(0);
  await expect(editor.locator('p').first()).toHaveText('A short sentence.');
  await expect(editor).toContainText('Second paragraph here.');

  await app.keyboard.press('ControlOrMeta+z');
  await expect(editor.locator('p').first()).toHaveText('This is a very long and wordy sentence that says little.');
  await expect(editor).toContainText('Second paragraph here.');
});

test('/summarize opens the assistant with the request sent', async ({ app }) => {
  test.slow();
  await app.setViewportSize({ width: 1280, height: 800 });
  await stubWebLLMWorker(app);
  await stubWebGPU(app);
  await importNote(app);
  await selectFolder(app, 'Main');
  await openNote(app, 'Weekend notes');
  const editor = activeEditor(app);
  await expect(editor).toContainText('Second paragraph here.');

  await editor.getByText('Second paragraph here.').click();
  await app.keyboard.press('End');
  await app.keyboard.press('Enter');
  await app.keyboard.type('/summarize');
  await app.keyboard.press('Enter');

  const panel = app.getByRole('region', { name: 'Assistant' });
  await expect(panel).toBeVisible();
  await app.getByRole('dialog', { name: /^Download / }).getByRole('button', { name: 'Continue' }).click();
  await assertTestOrigin(app);
  await expect(panel.getByText('Summarize the open note')).toBeVisible();
  await expect.poll(() => reloads(app)).toHaveLength(1);
  await finishLoad(app, 'ok');
  await queueReply(app, { answer: 'Two short paragraphs.' });
  await expect(panel.getByText('Two short paragraphs.')).toBeVisible();
  await screenshotInBothThemes(app, (theme) => `editor-summarize-panel-${theme}-1280.png`);
});
