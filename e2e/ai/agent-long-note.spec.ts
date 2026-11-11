import { test, expect } from '../fixtures';
import { stubWebGPU } from '../support/webgpu';
import { completionRequests, finishLoad, queueReply, reloads, stubWebLLMWorker } from '../support/webllm-worker';
import { activeTitleInput, openNote, screenshotInBothThemes, selectFolder } from '../support/actions';
import { LONG_NOTE_BODY } from '../evals/tasks';

// A long note reaches the model as an outline of its headings, and get_note with a section reads one
// part (#1025), so an answer can come from the end of the note. A scripted engine worker stands in
// for the model, so the spec drives the real loop, tools and local database.

const TITLE = 'Allotment diary';

test('"what is this about?" on a long note reads the outline, then one section', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await stubWebLLMWorker(app);
  await stubWebGPU(app);

  await app.getByRole('button', { name: 'Settings' }).click();
  const settings = app.getByRole('dialog');
  await settings.getByRole('tab', { name: 'Data & storage' }).click();
  await settings
    .locator('input[type="file"]')
    .setInputFiles([{ name: `${TITLE}.md`, mimeType: 'text/markdown', buffer: Buffer.from(`---\ntitle: ${TITLE}\n---\n${LONG_NOTE_BODY}`) }]);
  await expect(app.getByText('Successfully imported 1 notes')).toBeVisible();
  await app.keyboard.press('Escape');
  await selectFolder(app, 'Main');
  await openNote(app, TITLE);
  await expect(activeTitleInput(app)).toHaveValue(TITLE);
  const id = new URL(app.url()).pathname.split('/').pop()!;

  await app.getByRole('button', { name: 'Open assistant' }).click();
  const panel = app.getByRole('region', { name: 'Assistant' });
  const box = panel.getByPlaceholder('Type a message or /help...');
  await box.fill('what is this about?');
  await box.press('Enter');
  await app.getByRole('dialog', { name: /^Download / }).getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => reloads(app)).toHaveLength(1);
  await finishLoad(app, 'ok');
  await queueReply(app, { tool: 'get_note', args: { id } });
  await queueReply(app, { tool: 'get_note', args: { id, section: '## December' } });
  const answer = 'A year on the allotment, from building the greenhouse in January to pressing cider in December.';
  await queueReply(app, { answer });

  await expect(panel.getByText(answer)).toBeVisible();
  const requests = (await completionRequests(app))!;
  expect(requests).toHaveLength(3);
  // get_note offers section only after an outline was shown, so a small model can't send its question as one.
  expect(requests[0]).not.toContain('section');
  // The first read: every heading and how to read a part, not the body.
  expect(requests[1]).toContain('## November');
  expect(requests[1]).toContain('Call get_note with section');
  expect(requests[1]).not.toContain('beehive');
  // The second read: the last section only.
  expect(requests[2]).toContain('pressing cider');
  expect(requests[2]).not.toContain('tulip');

  await panel.getByText('2 steps').click();
  await expect(panel.getByRole('link', { name: TITLE })).toHaveCount(2);
  await screenshotInBothThemes(app, (theme) => `agent-long-note-${theme}-1280.png`);
});
