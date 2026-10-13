import { test, expect, withFencedPage, liveIdentityOrigin } from '../fixtures';
import type { Browser, Page } from '@playwright/test';
import { assertTestOrigin } from '../support/origin-guard';
import { createFolder, createNote, foldersNav, selectFolder } from '../support/actions';

// #618: sharing a folder makes every note in it public on its /share URL, a note created
// in it afterwards starts public, and stopping sharing makes them all private again.

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

test('sharing a folder publishes its notes and new ones, and stopping sharing makes them private', async ({ liveRun, browser }) => {
    test.setTimeout(300_000);
    const { page } = liveRun;
    // Its own folder, so a failure can't leave the run folder shared for the other specs.
    // Named like the run folder (`<run>-w<n>`) so global-teardown deletes it.
    const folder = `${process.env.E2E_LIVE_RUN_FOLDER}-w${100 + test.info().workerIndex}`;
    await createFolder(page, folder);
    await selectFolder(page, folder);

    const notes: { title: string; url: string }[] = [];
    for (const n of [1, 2, 3]) {
        const title = `Folder share ${n} ${Date.now()}`;
        await createNote(page, { title, body: `Body ${n}` });
        notes.push({ title, url: shareUrlOfOpenNote(page) });
    }

    await foldersNav(page).getByRole('button', { name: folder, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share folder…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Share folder', exact: true }).click();
    await expect(page.getByText('Folder shared. 3 notes made public.')).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('Escape');
    for (const note of notes) await isPublic(browser, note.url, note.title);

    // A new note in the shared folder starts public; its first push uploads it so.
    const newTitle = `Folder share new ${Date.now()}`;
    await createNote(page, { title: newTitle, body: 'Created after sharing' });
    const newUrl = shareUrlOfOpenNote(page);
    await expect(async () => isPublic(browser, newUrl, newTitle)).toPass({ timeout: 60_000 });
    notes.push({ title: newTitle, url: newUrl });

    // A new note in a private folder stays private.
    await selectFolder(page, liveRun.folderName);
    const privateTitle = `Private folder note ${Date.now()}`;
    await createNote(page, { title: privateTitle, body: 'Stays private' });
    await isPrivate(browser, shareUrlOfOpenNote(page));

    await foldersNav(page).getByRole('button', { name: folder, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share folder…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Stop sharing (make private)' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('4 notes will become private');
    await dialog.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect(page.getByText('Folder is private again. 4 notes made private.')).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('Escape');
    for (const note of notes) await isPrivate(browser, note.url);
});
