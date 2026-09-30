import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, typeInEditor, waitForSyncIdle } from '../support/actions';

// Layer 3, not layer 2 (#202): a replay can't cover this flow. The note gets a
// fresh random uniqueId on every run, so the pull after the reload returns the
// recording's note under a different id, and the app fetches a payload the
// recording never did (HAR_UNMATCHED GET /api/apps/v1/drive/files/payload).
test('a created then edited note syncs and survives a reload', async ({ liveRun }) => {
    const { page } = liveRun;
    const title = `Create-edit note ${Date.now()}`;
    await createNote(page, { title, body: 'Original text.' });
    await waitForSyncIdle(page);

    await typeInEditor(page, ' Appended text.');
    await waitForSyncIdle(page);

    await page.reload();
    await waitForAppReady(page);

    await expect(page.getByRole('button').filter({ hasText: title }).first()).toBeVisible();
    await expect(activeEditor(page)).toContainText('Original text. Appended text.');
});
