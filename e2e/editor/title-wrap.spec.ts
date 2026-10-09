import { test, expect } from '../fixtures';
import { activeTitleInput, createNote } from '../support/actions';

// A long title wraps instead of being cut off, up to three lines, then scrolls; it stays one line of text.
test('a long note title wraps to at most three lines', async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 800 });
  await createNote(app, { title: 'Short', body: 'Body.' });
  const title = activeTitleInput(app);
  const oneLine = (await title.boundingBox())!.height;

  const long = 'Nordic Loop: Oslo → Stockholm → Turku → Gothenburg → Copenhagen → Malmö → Bergen';
  await title.fill(long);
  await expect.poll(async () => (await title.boundingBox())!.height).toBeGreaterThan(oneLine * 1.5);

  await title.fill(`${long} ${long} ${long} ${long}`);
  await expect.poll(async () => (await title.boundingBox())!.height).toBeLessThanOrEqual(oneLine * 3 + 2);

  // Enter doesn't add a line break.
  await title.fill('One line');
  await title.press('End');
  await title.press('Enter');
  await expect(title).toHaveValue('One line');
});
