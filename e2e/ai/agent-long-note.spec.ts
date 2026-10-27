import { test, expect } from '../fixtures';
import { stubWebGPU } from '../support/webgpu';
import { completionRequests, finishLoad, queueReply, reloads, stubWebLLMWorker } from '../support/webllm-worker';
import { activeEditor, openNote, screenshotInBothThemes, selectFolder } from '../support/actions';

// "What is this about?" on a long open note is answered in steps (#797): the app reads the note
// part by part, one model call per part, then combines the part summaries in one last call. A
// scripted engine worker stands in for the model, so the spec checks what each call was given.

const PARTS = 10;
const LAST_POINT = 'The launch moves to 12 May';

/** One chapter of ~7,000 characters: a part of the summary, as two chapters do not fit in one. */
const chapter = (n: number) =>
  [
    `## Chapter ${n}`,
    ...Array.from({ length: 40 }, (_, p) => `Chapter ${n}, point ${p + 1}: the team went over the schedule, the budget and the open risks. `.repeat(2).trim()),
    ...(n === PARTS ? [`${LAST_POINT}, after the final review.`] : []),
  ].join('\n\n');

test('"what is this about?" on a 10-part note reads every part, then answers from all of them', async ({ app }) => {
  test.slow();
  await app.setViewportSize({ width: 1280, height: 800 });
  await stubWebLLMWorker(app);
  await stubWebGPU(app);

  const body = Array.from({ length: PARTS }, (_, i) => chapter(i + 1)).join('\n\n');
  await app.getByRole('button', { name: 'Settings' }).click();
  const settings = app.getByRole('dialog');
  await settings.getByRole('tab', { name: 'Data & storage' }).click();
  await settings
    .locator('input[type="file"]')
    .setInputFiles([{ name: 'Launch plan.md', mimeType: 'text/markdown', buffer: Buffer.from(`---\ntitle: Launch plan\n---\n${body}`) }]);
  await expect(app.getByText('Successfully imported 1 notes')).toBeVisible();
  await app.keyboard.press('Escape');
  await selectFolder(app, 'Main');
  await openNote(app, 'Launch plan');
  await expect(activeEditor(app)).toContainText(LAST_POINT);

  await app.getByRole('button', { name: 'Open assistant' }).click();
  const panel = app.getByRole('region', { name: 'Assistant' });
  const box = panel.getByPlaceholder('Type a message or /help...');
  await box.fill('what is this about?');
  await box.press('Enter');
  await app.getByRole('dialog', { name: /^Download / }).getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => reloads(app)).toHaveLength(1);
  await finishLoad(app, 'ok');

  // One summary per part, then the answer that combines them.
  for (let n = 1; n <= PARTS; n++) {
    await queueReply(app, { answer: n === PARTS ? `Chapter ${n} covers the risks. ${LAST_POINT}.` : `Chapter ${n} covers the risks.` });
  }
  const answer = `A launch plan, chapter by chapter, from the schedule to the risks. ${LAST_POINT}.`;
  await queueReply(app, { answer });

  await expect(panel.getByText(answer)).toBeVisible();
  await panel.getByText(`${PARTS} steps`).click();
  await expect(panel.getByText(`Reading part ${PARTS} of ${PARTS}`)).toBeVisible();
  await screenshotInBothThemes(app, (theme) => `agent-long-note-${theme}-1280.png`);

  const requests = (await completionRequests(app))!;
  expect(requests).toHaveLength(PARTS + 1);
  // Each part call gets its own chapter, the last one included.
  requests.slice(0, PARTS).forEach((request, i) => {
    expect(request).toContain(`Part ${i + 1} of ${PARTS}`);
    expect(request).toContain(`## Chapter ${i + 1}`);
  });
  expect(requests[PARTS - 1]).toContain(LAST_POINT);
  // The combine call gets every summary, the last part's point included, and the question.
  const combine = requests[PARTS];
  expect(combine).toContain('Part 1: Chapter 1 covers the risks.');
  expect(combine).toContain(`Part ${PARTS}: Chapter ${PARTS} covers the risks. ${LAST_POINT}.`);
  expect(combine).toContain('what is this about?');
});
