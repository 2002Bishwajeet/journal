import { test, expect } from '../fixtures';
import { createNote, screenshotInBothThemes } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { shareDialog } from '../support/shareDialog';

// #325: an agent's share_note request waits on the note until the owner reviews it in the
// Share dialog or declines it. Backend-free: the request is seeded as the MCP's write would
// arrive after a pull. Making the note public needs a Homebase, so this covers the notice,
// the dialog with the request loaded, and Decline; publishing is the existing dialog's path.

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

test('a share request shows on the note, loads into the Share dialog, and Decline drops it', async ({ app }) => {
  test.setTimeout(90_000);
  await assertTestOrigin(app);
  await app.setViewportSize(DESKTOP);
  const title = `Share request ${Date.now()}`;
  await createNote(app, { title, body: 'A note an agent wants to share.' });

  const { docId } = (await app.evaluate(() => window.__journalE2E!.openNoteJSON()))!;
  await app.evaluate(
    (id) =>
      window.__journalE2E!.seedShareRequest(id, {
        access: 'people',
        with: [
          { kind: 'person', id: 'sam.homebase.test', role: 'viewer' },
          { kind: 'circle', id: 'No such circle', role: 'viewer' },
        ],
        by: 'agent:claude-code',
        at: Date.now(),
      }),
    docId,
  );

  // 1. The notice on the note names the agent and what it asks.
  const notice = app.getByRole('status').filter({ hasText: 'Claude Code asks to share this note with sam.homebase.test' });
  await expect(notice).toBeVisible();
  await screenshotInBothThemes(app, (theme) => `share-request-notice-${theme}-1280.png`);
  await app.setViewportSize(PHONE);
  await expect(notice).toBeVisible();
  const overflow = await notice.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await screenshotInBothThemes(app, (theme) => `share-request-notice-${theme}-390.png`);
  await app.setViewportSize(DESKTOP);

  // 2. Review opens the Share dialog with the person filled in as a Viewer, and the unknown circle refused.
  await notice.getByRole('button', { name: 'Review' }).click();
  const dialog = shareDialog(app);
  await expect(dialog).toBeVisible();
  const request = dialog.getByRole('group', { name: 'Share request' });
  await expect(request).toContainText('Claude Code asks to share this note');
  // The draft waits for the owner's circles, which load from (here: fail to reach) the server
  await expect(request).toContainText('No circle named “No such circle”', { timeout: 30_000 });
  await expect(dialog.getByLabel('Role for sam.homebase.test', { exact: true })).toBeVisible();
  await screenshotInBothThemes(app, (theme) => `share-request-dialog-${theme}-1280.png`);

  // 3. Decline drops the request: the draft goes, and so does the note's notice.
  await request.getByRole('button', { name: 'Decline request' }).click();
  await expect(request).toBeHidden();
  await expect(dialog.getByLabel('Role for sam.homebase.test', { exact: true })).toHaveCount(0);
  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(notice).toHaveCount(0);

  // 4. A request to go public is answered with Make public; Decline from the note drops it too.
  await app.evaluate(
    (id) => window.__journalE2E!.seedShareRequest(id, { access: 'public', by: 'agent:claude-code', at: Date.now() }),
    docId,
  );
  const publicNotice = app.getByRole('status').filter({ hasText: 'Claude Code asks to make this note public.' });
  await expect(publicNotice).toBeVisible();
  await publicNotice.getByRole('button', { name: 'Review' }).click();
  await expect(dialog.getByText('To agree, use Make public under General access.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Make Note Public' })).toBeVisible();
  await app.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await publicNotice.getByRole('button', { name: 'Decline' }).click();
  await expect(publicNotice).toHaveCount(0);
});
