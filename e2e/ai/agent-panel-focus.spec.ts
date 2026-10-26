import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { stubWebGPU } from '../support/webgpu';
import { finishLoad, queueReply, reloads, stubWebLLMWorker } from '../support/webllm-worker';
import { activeEditor, openNote, selectFolder } from '../support/actions';

// Keyboard only, the assistant panel never drops focus to the page (#704): it opens on the message box,
// a sent message moves focus to Stop, a finished turn brings it back to the message box, and closing
// returns it to the button that opened the panel.

const NOTES = { 'Packing list': 'Passport and charger.', 'Weekend notes': 'First paragraph here.' };

async function importNotes(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  await dialog.locator('input[type="file"]').setInputFiles(
    Object.entries(NOTES).map(([title, body]) => ({ name: `${title}.md`, mimeType: 'text/markdown', buffer: Buffer.from(`---\ntitle: ${title}\n---\n${body}`) })),
  );
  await expect(page.getByText('Successfully imported 2 notes')).toBeVisible();
  await page.keyboard.press('Escape');
}

test('keyboard only: focus stays in the assistant panel through a turn, a proposal, Stop and close', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await stubWebLLMWorker(app);
  await stubWebGPU(app);
  await importNotes(app);
  await selectFolder(app, 'Main');
  await openNote(app, 'Packing list');
  await expect(activeEditor(app)).toContainText('Passport and charger.');
  const packingId = new URL(app.url()).pathname.split('/').pop()!;
  // The append goes to another note than the open one, so it shows as a card in the panel.
  await openNote(app, 'Weekend notes');
  await expect(activeEditor(app)).toContainText('First paragraph here.');

  const opener = app.getByRole('button', { name: 'Open assistant' });
  await opener.focus();
  await app.keyboard.press('Enter');
  const panel = app.getByRole('region', { name: 'Assistant' });
  const box = panel.getByRole('textbox', { name: 'Message' });
  const stop = panel.getByRole('button', { name: 'Stop' });
  const download = app.getByRole('dialog', { name: /^Download / });
  await expect(box).toBeFocused();

  /** Types a request, Enter, then Continue in the download dialog, all by keyboard. */
  async function ask(text: string) {
    await app.keyboard.type(text);
    await app.keyboard.press('Enter');
    await expect(download).toBeVisible();
    await download.getByRole('button', { name: 'Continue' }).focus();
    await app.keyboard.press('Enter');
    await assertTestOrigin(app);
  }

  // A cross-note proposal: rejected by keyboard, focus goes to Stop, then back to the message box.
  await ask("add 'buy socks' to my packing list");
  await expect(stop).toBeFocused();
  await expect.poll(() => reloads(app)).toHaveLength(1);
  await finishLoad(app, 'ok');
  await queueReply(app, { tool: 'append_to_note', args: { id: packingId, markdown: 'buy socks' } });
  const card = panel.getByRole('group', { name: /^Review the assistant's proposal/ });
  await expect(card.getByRole('button', { name: 'Reject' })).toBeVisible();
  await app.keyboard.press('Shift+Tab');
  await expect(card.getByRole('button', { name: 'Reject' })).toBeFocused();
  await app.keyboard.press('Enter');
  await expect(stop).toBeFocused();
  await queueReply(app, { answer: 'Kept it.' });
  await expect(panel.getByText('Kept it.')).toBeVisible();
  await expect(box).toBeFocused();

  // Stop by keyboard: focus returns to the message box.
  await ask('tell me a very long story');
  await queueReply(app, null);
  await expect(stop).toBeFocused();
  await app.keyboard.press('Enter');
  await expect(panel.getByText('Stopped.')).toBeVisible();
  await expect(box).toBeFocused();

  // Close by keyboard: focus returns to the button that opens the panel.
  await panel.getByRole('button', { name: 'Close assistant' }).focus();
  await app.keyboard.press('Enter');
  await expect(panel).toHaveCount(0);
  await expect(opener).toBeFocused();
});
