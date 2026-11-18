import { test, expect } from '../fixtures';
import { createNote, shareNotePublicly, unshareNotePublicly, inBothThemes } from '../support/actions';

// #1413: the note list row says "Public link" while the note is shared, and the label goes when
// sharing stops. ("On your feed" comes from the same helper, covered by noteSharingLabel.test.ts.)
const SIZES = { 1280: { width: 1280, height: 720 }, 390: { width: 390, height: 844 } } as const;

test('the note list row shows Public link while the note is shared', async ({ liveRun }) => {
  const { page } = liveRun;
  const title = `Sharing label ${Date.now()}`;
  await createNote(page, { title, body: 'Shared, then made private.' });
  const row = page.getByRole('button').filter({ hasText: title }).first();
  await expect(row).not.toContainText('Public link');

  await shareNotePublicly(page, title);
  await expect(row).toContainText('Public link');
  for (const [name, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size);
    await inBothThemes(page, (theme) =>
      page.screenshot({ path: test.info().outputPath(`sharing-label-${theme}-${name}.png`) }),
    );
  }
  await page.setViewportSize(SIZES[1280]);

  await unshareNotePublicly(page, title);
  await expect(row).not.toContainText('Public link');
});
