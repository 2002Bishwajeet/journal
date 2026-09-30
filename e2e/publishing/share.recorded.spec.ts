import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote, shareNotePublicly, waitForSyncIdle } from '../support/actions';

// Fixed text, not Date.now(): a replay gets back what the recording uploaded.
const title = 'Recorded public note';
const body = 'This note is public and readable without signing in.';

test('a note made public renders from its share link with no session', async ({ app, anonPage }) => {
    await createNote(app, { title, body });
    await waitForSyncIdle(app);
    const shareUrl = await shareNotePublicly(app, title);

    await anonPage.goto(shareUrl);
    await assertTestOrigin(anonPage);
    await expect(anonPage.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 });
    await expect(anonPage.getByRole('article')).toContainText(body);
});
