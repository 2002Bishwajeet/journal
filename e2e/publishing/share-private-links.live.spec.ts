import { test, expect, withFencedPage, liveIdentityOrigin } from '../fixtures';
import type { Browser, Page } from '@playwright/test';
import { assertTestOrigin } from '../support/origin-guard';
import { activeEditor, createNote, shareNotePublicly, waitForNoteSaved } from '../support/actions';

// #617: making a note public that links to private notes offers to publish them too.
// Against a real Homebase: the choice really changes who can read the linked note.

/** The share URL of the note open in `page` (its id is the route's last segment). */
function shareUrlOfOpenNote(page: Page): string {
    const noteId = new URL(page.url()).pathname.split('/').pop();
    return new URL(`/share/${encodeURIComponent(process.env.E2E_LIVE_IDENTITY!)}/${noteId}`, page.url()).href;
}

async function loggedOut(browser: Browser, url: string, check: (anon: Page) => Promise<void>): Promise<void> {
    await withFencedPage(browser, {}, async (anon) => {
        await anon.goto(url);
        await assertTestOrigin(anon);
        await check(anon);
    }, [liveIdentityOrigin()]);
}

const heading = (anon: Page, name: string) =>
    expect(anon.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 15_000 });

/** Creates B (private) and C (public), then A linking to both; returns B's share URL. */
async function setUp(page: Page, stamp: string) {
    const b = `Private target ${stamp}`;
    const c = `Public target ${stamp}`;
    const a = `Linker ${stamp}`;
    await createNote(page, { title: b, body: 'B body' });
    const bUrl = shareUrlOfOpenNote(page);
    await createNote(page, { title: c, body: 'C body' });
    await shareNotePublicly(page, c);
    await createNote(page, { title: a, body: `See [[${b}` });
    await activeEditor(page).press('Enter');
    await activeEditor(page).press('End');
    await activeEditor(page).pressSequentially(` and [[${c}`);
    await expect(page.locator('[data-index]').filter({ hasText: c }).first()).toBeVisible();
    await activeEditor(page).press('Enter');
    await waitForNoteSaved(page);
    const aUrl = shareUrlOfOpenNote(page);

    await page.getByRole('button').filter({ hasText: a }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Make Note Public' }).click();
    await expect(dialog.getByText('This note links to 1 private note.')).toBeVisible();
    await expect(dialog.getByText(b, { exact: true })).toBeVisible();
    await expect(dialog.getByText(c, { exact: true })).not.toBeVisible();
    return { a, b, aUrl, bUrl, dialog };
}

test('"Make these public too" publishes the note and its private links', async ({ liveRun, browser }) => {
    test.setTimeout(300_000);
    const { a, b, aUrl, bUrl, dialog } = await setUp(liveRun.page, `${Date.now()}`);
    await dialog.getByRole('button', { name: 'Make these public too' }).click();
    await expect(dialog.locator('input[readonly]')).toBeVisible({ timeout: 60_000 });
    // liveRun's page is shared across the worker's tests: close the dialog for the next one.
    await liveRun.page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await loggedOut(browser, aUrl, async (anon) => {
        await heading(anon, a);
        // #616: the link on A's share page opens B's share page, which is now public.
        await anon.getByRole('article').getByRole('link', { name: b }).click();
        await expect(anon).toHaveURL(bUrl);
        await heading(anon, b);
    });
});

test('"Continue anyway" publishes only the note', async ({ liveRun, browser }) => {
    test.setTimeout(300_000);
    const { a, aUrl, bUrl, dialog } = await setUp(liveRun.page, `${Date.now()}`);
    await dialog.getByRole('button', { name: 'Continue anyway' }).click();
    await expect(dialog.locator('input[readonly]')).toBeVisible({ timeout: 60_000 });
    // liveRun's page is shared across the worker's tests: close the dialog for the next one.
    await liveRun.page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await loggedOut(browser, aUrl, (anon) => heading(anon, a));
    await loggedOut(browser, bUrl, (anon) => heading(anon, 'Note Not Found'));
});
