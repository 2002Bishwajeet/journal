import { test, expect, waitForAppReady } from '../fixtures';
import { installNetworkFence, assertNoFenceViolations } from '../support/network-fence';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote, openNote, typeInEditor, selectFolder, activeEditor } from '../support/actions';

test('a note created on one device appears on another via realtime sync, and an edit syncs back', async ({ liveRun, browser }) => {
    const { page: pageA, folderName } = liveRun;
    const identity = process.env.E2E_LIVE_IDENTITY;
    if (!identity) throw new Error('E2E_LIVE_IDENTITY must be set to run the `live` project.');

    // Device B: a second context on the same real identity (same storageState
    // as the `live` project's default, since this context is created manually).
    const contextB = await browser.newContext({ storageState: 'e2e/.auth/live.json' });
    const { violations } = await installNetworkFence(contextB, [`https://${identity}`]);
    const pageB = await contextB.newPage();

    try {
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
    } finally {
        await contextB.close();
    }
    assertNoFenceViolations(violations);
});
