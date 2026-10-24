import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { stubWebGPU } from '../support/webgpu';
import { finishLoad, queueReply, reloads, stubWebLLMWorker } from '../support/webllm-worker';
import { activeEditor, openNote, screenshotInBothThemes, selectFolder } from '../support/actions';

// The assistant adds to a note that is not open and makes new notes (#702). Each shows as a card in
// the panel with Accept and Reject, and nothing is written until Accept. A scripted engine worker
// stands in for the model, so the spec drives the real loop, tools and local database.

const files = [
  { name: 'Packing list.md', body: '---\ntitle: Packing list\n---\nPassport and charger.' },
  { name: 'Weekend notes.md', body: '---\ntitle: Weekend notes\n---\nFirst paragraph here.' },
];

async function importNotes(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Data & storage' }).click();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles(files.map(({ name, body }) => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(body) })));
  await expect(page.getByText('Successfully imported 2 notes')).toBeVisible();
  await page.keyboard.press('Escape');
}

test('the assistant appends to another note and creates a note, each only after Accept', async ({ app }) => {
  test.slow();
  await app.setViewportSize({ width: 1280, height: 800 });
  await stubWebLLMWorker(app);
  await stubWebGPU(app);

  await importNotes(app);
  await selectFolder(app, 'Main');
  // The model gets note ids from search results; the spec reads this one from the address.
  await openNote(app, 'Packing list');
  await expect(activeEditor(app)).toContainText('Passport and charger.');
  const packingId = new URL(app.url()).pathname.split('/').filter(Boolean).pop()!;
  await openNote(app, 'Weekend notes');
  await expect(activeEditor(app)).toContainText('First paragraph here.');

  await app.getByRole('button', { name: 'Open assistant' }).click();
  const panel = app.getByRole('region', { name: 'Assistant' });
  const box = panel.getByPlaceholder('Type a message or /help...');
  const download = app.getByRole('dialog', { name: /^Download / });
  const appendCard = panel.getByRole('group', { name: "Review the assistant's proposal: Append to 'Packing list'" });
  const append = { tool: 'append_to_note', args: { id: packingId, markdown: 'buy socks' } };

  // Reject: the card shows the text to add, and the note stays as it was.
  await box.fill("add 'buy socks' to my packing list");
  await box.press('Enter');
  await download.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => reloads(app)).toHaveLength(1);
  await finishLoad(app, 'ok');
  await queueReply(app, append);
  await expect(appendCard).toBeVisible();
  await expect(appendCard.getByLabel('Markdown to add')).toHaveText('buy socks');
  await expect(panel.getByText('Waiting for your OK')).toBeVisible();
  await screenshotInBothThemes(app, (theme) => `agent-append-card-${theme}-1280.png`);

  await queueReply(app, { answer: 'I left it as it is.' });
  await appendCard.getByRole('button', { name: 'Reject' }).click();
  await expect(panel.getByText('I left it as it is.')).toBeVisible();
  await expect(appendCard.getByText('Rejected')).toBeVisible();
  await expect(appendCard.getByRole('button', { name: 'Accept' })).toHaveCount(0);

  await openNote(app, 'Packing list');
  await expect(activeEditor(app)).toContainText('Passport and charger.');
  await expect(activeEditor(app)).not.toContainText('buy socks');
  await openNote(app, 'Weekend notes');

  // Accept: the line is added, and the card links to the note.
  await box.fill("add 'buy socks' to my packing list");
  await box.press('Enter');
  await download.getByRole('button', { name: 'Continue' }).click();
  await assertTestOrigin(app);
  await queueReply(app, append);
  await queueReply(app, { answer: 'Added it.' });
  const cards = panel.getByRole('group', { name: "Review the assistant's proposal: Append to 'Packing list'" });
  await expect(cards.last().getByRole('button', { name: 'Accept' })).toBeVisible();
  await cards.last().getByRole('button', { name: 'Accept' }).click();
  await expect(panel.getByText('Added it.')).toBeVisible();
  const done = cards.last();
  await expect(done.getByText('Done')).toBeVisible();
  await screenshotInBothThemes(app, (theme) => `agent-append-done-${theme}-1280.png`);

  await done.getByRole('link', { name: 'Packing list' }).click();
  await expect(activeEditor(app)).toContainText('Passport and charger.');
  await expect(activeEditor(app)).toContainText('buy socks');

  // Version history keeps the note as it was before the line.
  await app.getByRole('button', { name: 'Version history' }).click();
  const history = app.getByRole('dialog', { name: 'Version history' });
  const before = history.getByRole('listitem').filter({ hasText: 'Passport and charger.' });
  await expect(before).toHaveCount(1);
  await expect(before).not.toContainText('buy socks');
  await app.keyboard.press('Escape');
  await expect(history).toBeHidden();

  // A new note goes to Main.
  await box.fill('make a note of my ideas');
  await box.press('Enter');
  await download.getByRole('button', { name: 'Continue' }).click();
  await assertTestOrigin(app);
  await queueReply(app, { tool: 'create_note', args: { title: 'Ideas', markdown: '- first idea' } });
  await queueReply(app, { answer: 'Made it.' });
  const createCard = panel.getByRole('group', { name: "Review the assistant's proposal: Create note 'Ideas' in Main" });
  await expect(createCard).toBeVisible();
  await expect(createCard.getByLabel('Markdown to add')).toHaveText('- first idea');
  await screenshotInBothThemes(app, (theme) => `agent-create-card-${theme}-1280.png`);
  await createCard.getByRole('button', { name: 'Accept' }).click();
  await expect(panel.getByText('Made it.')).toBeVisible();
  await createCard.getByRole('link', { name: 'Ideas' }).click();
  await expect(activeEditor(app)).toContainText('first idea');
});
