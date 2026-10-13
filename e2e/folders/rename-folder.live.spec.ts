import { test, expect, withFencedPage, waitForAppReady, liveIdentityOrigin, LIVE_STORAGE_STATE } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createFolder, createNote, foldersNav, selectFolder } from '../support/actions';

// #620: renaming a shared folder reaches Homebase: a second device sees the new name,
// and the folder is still shared.

test('a renamed shared folder keeps its share and shows the new name on a second device', async ({ liveRun, browser }) => {
    test.setTimeout(300_000);
    const { page } = liveRun;
    // Named like the run folder (`<run>-w<n>`) so global-teardown deletes it, before and after the rename.
    const base = `${process.env.E2E_LIVE_RUN_FOLDER}-w${400 + test.info().workerIndex}`;
    const renamed = `${process.env.E2E_LIVE_RUN_FOLDER}-w${500 + test.info().workerIndex}`;
    await createFolder(page, base);
    await selectFolder(page, base);
    await createNote(page, { title: `Rename live ${Date.now()}`, body: 'x' });
    await foldersNav(page).getByRole('button', { name: base, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share folder' }).click();
    await expect(page.getByText(/^Folder shared\./)).toBeVisible({ timeout: 60_000 });

    await foldersNav(page).getByRole('button', { name: base, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Rename Folder' }).click();
    const input = page.getByRole('dialog').getByPlaceholder('Folder Name');
    await input.fill(renamed);
    await input.press('Enter');
    await expect(foldersNav(page).getByRole('button', { name: renamed, exact: true })).toBeVisible();

    // A fresh context has the login but an empty local database: a second device.
    await withFencedPage(browser, { storageState: LIVE_STORAGE_STATE }, async (other) => {
        await other.goto('/');
        await assertTestOrigin(other);
        await waitForAppReady(other);
        const button = foldersNav(other).getByRole('button', { name: renamed, exact: true });
        await expect(button).toHaveAttribute('aria-description', 'Shared publicly', { timeout: 120_000 });
        await expect(foldersNav(other).getByRole('button', { name: base, exact: true })).toHaveCount(0);
    }, [liveIdentityOrigin()]);
});
