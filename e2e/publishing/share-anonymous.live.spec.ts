import { test, expect, withFencedPage, liveIdentityOrigin } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote, shareNotePublicly } from '../support/actions';

test('a public note is readable via its share link with no session', async ({ liveRun, browser }) => {
    const { page } = liveRun;
    const title = `Public note ${Date.now()}`;
    const body = 'This note is public and readable without signing in.';
    await createNote(page, { title, body });

    const shareUrl = await shareNotePublicly(page, title);

    // No storage state; guest reads still hit the real identity's guest API.
    await withFencedPage(browser, {}, async (anonPage) => {
        await anonPage.goto(shareUrl);
        await assertTestOrigin(anonPage);
        await expect(anonPage.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 });
        await expect(anonPage.getByRole('article')).toContainText(body);
    }, [liveIdentityOrigin()]);
});
