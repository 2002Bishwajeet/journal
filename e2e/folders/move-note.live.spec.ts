import { test, expect, withFencedPage, waitForAppReady, liveIdentityOrigin, LIVE_STORAGE_STATE } from '../fixtures';
import type { Browser, Page } from '@playwright/test';
import { assertTestOrigin } from '../support/origin-guard';
import { createFolder, createNote, foldersNav, selectFolder } from '../support/actions';

// #622: moving a note into a shared folder makes its share URL open logged out, moving it
// back out makes it private again, and the move reaches a second device after sync.

/** The share URL of the note open in `page` (its id is the route's last segment). */
function shareUrlOfOpenNote(page: Page): string {
    const noteId = new URL(page.url()).pathname.split('/').pop();
    return new URL(`/share/${encodeURIComponent(process.env.E2E_LIVE_IDENTITY!)}/${noteId}`, page.url()).href;
}

/** Open `url` logged out, in a fresh context (no cache can mask the guest API's answer). */
async function openLoggedOut(browser: Browser, url: string, check: (anon: Page) => Promise<void>): Promise<void> {
    await withFencedPage(browser, {}, async (anon) => {
        await anon.goto(url);
        await assertTestOrigin(anon);
        await check(anon);
    }, [liveIdentityOrigin()]);
}

const isPublic = (browser: Browser, url: string, title: string) =>
    openLoggedOut(browser, url, (anon) =>
        expect(anon.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 }));

const isPrivate = (browser: Browser, url: string) =>
    openLoggedOut(browser, url, async (anon) => {
        await expect(anon.getByRole('heading', { level: 1, name: 'Note Not Found' })).toBeVisible({ timeout: 15_000 });
        await expect(anon.getByText('This note is not shared publicly.')).toBeVisible();
    });

async function moveTo(page: Page, title: string, folder: string) {
    await page.getByTestId('note-row').filter({ hasText: title }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to folder…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${folder}`) }).click();
    await expect(page.getByText(`Moved to ${folder}`)).toBeVisible({ timeout: 60_000 });
}

test('moving a note into a shared folder publishes it, moving it out makes it private, and a second device sees the move', async ({ liveRun, browser }) => {
    test.setTimeout(300_000);
    const { page } = liveRun;
    // Their own folders, named like the run folder (`<run>-w<n>`) so global-teardown deletes them.
    const prefix = `${process.env.E2E_LIVE_RUN_FOLDER}-w${300 + test.info().workerIndex}`;
    const shared = `${prefix}-shared`;
    const privateFolder = `${prefix}-private`;
    await createFolder(page, shared);
    await createFolder(page, privateFolder);
    await foldersNav(page).getByRole('button', { name: shared, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share folder…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Share folder', exact: true }).click();
    await expect(page.getByText(/^Folder shared\./)).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('Escape');

    await selectFolder(page, privateFolder);
    const title = `Moved note ${Date.now()}`;
    await createNote(page, { title, body: 'Travels between folders' });
    const url = shareUrlOfOpenNote(page);
    await isPrivate(browser, url);

    await moveTo(page, title, shared);
    await expect(async () => isPublic(browser, url, title)).toPass({ timeout: 60_000 });

    // A second device (fresh local database) files it under the shared folder.
    await withFencedPage(browser, { storageState: LIVE_STORAGE_STATE }, async (other) => {
        await other.goto('/');
        await assertTestOrigin(other);
        await waitForAppReady(other);
        await selectFolder(other, shared);
        await expect(other.getByTestId('note-row').filter({ hasText: title })).toHaveCount(1, { timeout: 120_000 });
        // Not checked: the private folder's own absence there. A new folder reaches
        // Homebase on the next background sync, which this test doesn't wait for.
    }, [liveIdentityOrigin()]);

    // The open note's URL followed it into the shared folder; move it back from there.
    await selectFolder(page, shared);
    await moveTo(page, title, privateFolder);
    await expect(async () => isPrivate(browser, url)).toPass({ timeout: 60_000 });

    await selectFolder(page, privateFolder);
    await expect(page.getByTestId('note-row').filter({ hasText: title })).toHaveCount(1);
    await selectFolder(page, shared);
    await expect(page.getByTestId('note-row').filter({ hasText: title })).toHaveCount(0);
});
