import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { stubWebGPU } from '../support/webgpu';
import { completionRequests, finishLoad, queueReply, reloads, stubWebLLMWorker } from '../support/webllm-worker';
import { activeTitleInput, openNote, screenshotInBothThemes, selectFolder } from '../support/actions';

// The chat panel is the in-app agent (#699): it shows each step, answers from the notes
// on this device, can be stopped, and never sees a note kept from AI. A scripted engine
// worker stands in for the model, so the spec drives the real loop, tools and local database.

const SECRET = 'SECRET-TEXT-42';

async function importNotes(page: Page, notes: Record<string, string>) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  await dialog.locator('input[type="file"]').setInputFiles(
    Object.entries(notes).map(([name, text]) => ({ name: `${name}.md`, mimeType: 'text/markdown', buffer: Buffer.from(text) })),
  );
  await expect(page.getByText(`Successfully imported ${Object.keys(notes).length} notes`)).toBeVisible();
  await page.keyboard.press('Escape');
}

/** Opens the note from the list and returns its id, the last part of the URL. */
async function openNoteId(page: Page, title: string): Promise<string> {
  await openNote(page, title);
  await expect(activeTitleInput(page)).toHaveValue(title);
  return new URL(page.url()).pathname.split('/').pop()!;
}

test('the panel answers from the notes, shows its steps, keeps an excluded note out, and stops', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await stubWebLLMWorker(app);
  await stubWebGPU(app);

  await importNotes(app, {
    'Packing list': '---\ntitle: Packing list\n---\nI packed a passport, a charger and hiking boots for the trip.',
    'Meeting notes': '---\ntitle: Meeting notes\n---\nAgenda for Monday.',
    'Secret plan': `---\ntitle: Secret plan\nexcludeFromAI: true\n---\n${SECRET} is the plan.`,
  });
  await selectFolder(app, 'Main');
  const packingId = await openNoteId(app, 'Packing list');
  const secretId = await openNoteId(app, 'Secret plan');
  await openNoteId(app, 'Meeting notes');

  await app.getByRole('button', { name: 'Open assistant' }).click();
  const panel = app.getByRole('region', { name: 'Assistant' });
  const box = panel.getByPlaceholder('Type a message or /help...');
  await expect(panel.getByText('Ask me anything about your notes!')).toBeVisible();
  // Experimental, with a pointer to MCP agents (#936).
  await expect(panel.getByRole('heading', { name: 'Assistant Experimental' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Set up an agent' })).toHaveAttribute('href', 'https://journal.cloudx.run/agents');

  // Turn 1: search, read, answer. Nothing downloads before the dialog is accepted.
  await box.fill('what did I pack?');
  await box.press('Enter');
  // The stub keeps no model files, so the dialog shows on every send; a loaded model needs no second load.
  const download = app.getByRole('dialog', { name: /^Download / });
  await expect(download).toBeVisible();
  expect(await reloads(app)).toEqual([]);
  await download.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => reloads(app)).toHaveLength(1);
  await expect(panel.getByText(/Fetching stub model 42%/)).toBeVisible();
  await finishLoad(app, 'ok');
  // The worker starts with the first load, so replies queue only after it.
  await queueReply(app, { tool: 'search_notes', args: { query: 'packing' } });
  await queueReply(app, { tool: 'get_note', args: { id: packingId } });
  await queueReply(app, { answer: 'You packed a passport, a charger and hiking boots.' });

  await expect(panel.getByText('You packed a passport, a charger and hiking boots.')).toBeVisible();
  const steps = panel.getByText('2 steps');
  await steps.click();
  await expect(panel.getByText("Searched notes for 'packing'")).toBeVisible();
  await expect(panel.getByText(/^Read '/)).toContainText("Read 'Packing list'");
  await screenshotInBothThemes(app, (theme) => `agent-panel-${theme}-1280.png`);

  // The model got the open note's name, not its body.
  const requests = (await completionRequests(app))!;
  expect(requests[0]).toContain('Meeting notes');
  expect(requests[0]).not.toContain('Agenda for Monday');

  // Turn 2: the excluded note is not found, and its text never reaches the model or the panel.
  await queueReply(app, { tool: 'get_note', args: { id: secretId } });
  await queueReply(app, { answer: 'I could not find that note.' });
  await box.fill('read my secret plan');
  await box.press('Enter');
  await download.getByRole('button', { name: 'Continue' }).click();
  await expect(panel.getByText('I could not find that note.')).toBeVisible();
  await panel.getByText('Error', { exact: true }).click();
  await expect(panel.getByText(/Note not found/)).toBeVisible();
  await expect(panel).not.toContainText(SECRET);
  expect((await completionRequests(app))!.join('\n')).not.toContain(SECRET);

  // Stop ends a pending generation.
  await queueReply(app, null);
  await box.fill('tell me a very long story');
  await box.press('Enter');
  await download.getByRole('button', { name: 'Continue' }).click();
  const stop = panel.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(panel.getByText('Stopped.')).toBeVisible();
  await expect(stop).toHaveCount(0);
  await expect(box).toBeEnabled();

  // A step's note title opens that note.
  await assertTestOrigin(app);
  await panel.getByRole('link', { name: 'Packing list' }).click();
  await expect(app).toHaveURL(new RegExp(`${packingId}$`));
  await expect(activeTitleInput(app)).toHaveValue('Packing list');
});
