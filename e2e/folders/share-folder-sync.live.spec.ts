import { test, expect, withFencedPage, waitForAppReady, liveIdentityOrigin, LIVE_STORAGE_STATE } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createFolder, createNote, foldersNav, selectFolder } from '../support/actions';

// #618: a folder shared on one device shows as shared on another after sync. Sharing
// pushes an already-synced folder, which used to be rejected as a duplicate create.

test('a folder shared on one device is shared on a second device', async ({ liveRun, browser }) => {
    test.setTimeout(300_000);
    const { page } = liveRun;
    // Named like the run folder (`<run>-w<n>`) so global-teardown deletes it.
    const folder = `${process.env.E2E_LIVE_RUN_FOLDER}-w${200 + test.info().workerIndex}`;
    await createFolder(page, folder);
    await selectFolder(page, folder);
    await createNote(page, { title: `Shared on device A ${Date.now()}`, body: 'x' });
    await foldersNav(page).getByRole('button', { name: folder, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share folder…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Share folder', exact: true }).click();
    await expect(page.getByText(/^Folder shared\./)).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('Escape');

    // A fresh context has the login but an empty local database: a second device.
    await withFencedPage(browser, { storageState: LIVE_STORAGE_STATE }, async (other) => {
        await other.goto('/');
        await assertTestOrigin(other);
        await waitForAppReady(other);
        const button = foldersNav(other).getByRole('button', { name: folder, exact: true });
        await expect(button).toHaveAttribute('aria-description', 'Shared publicly', { timeout: 120_000 });
    }, [liveIdentityOrigin()]);
});
