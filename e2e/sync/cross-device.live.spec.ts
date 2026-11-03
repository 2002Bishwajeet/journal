import { test, expect, waitForAppReady, withFencedPage, liveIdentityOrigin, LIVE_STORAGE_STATE } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote, openNote, typeInEditor, selectFolder, activeEditor } from '../support/actions';

test('a note created on one device appears on another via realtime sync, and an edit syncs back', async ({ liveRun, browser }) => {
    const { page: pageA, folderName } = liveRun;

    // Device B: a second context on the same real identity.
    await withFencedPage(browser, { storageState: LIVE_STORAGE_STATE }, async (pageB) => {
        await pageB.goto('/');
        await assertTestOrigin(pageB);
        await waitForAppReady(pageB);
        await selectFolder(pageB, folderName);

        const title = `Live sync ${Date.now()}`;
        await createNote(pageA, { title, body: 'Created on device A' });

        // No reload on B — this is the websocket/realtime path layer 2 can't cover.
        await expect(pageB.getByRole('button').filter({ hasText: title })).toBeVisible({ timeout: 30_000 });

        await openNote(pageB, title);
        await typeInEditor(pageB, ' — edited on B');

        await expect(activeEditor(pageA)).toContainText('edited on B', { timeout: 30_000 });
    }, [liveIdentityOrigin()]);
});
