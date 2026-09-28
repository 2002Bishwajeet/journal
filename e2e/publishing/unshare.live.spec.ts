import { test, expect, withFencedPage, liveIdentityOrigin } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote, shareNotePublicly, unshareNotePublicly } from '../support/actions';

test('unsharing a note blocks anonymous access to its old share URL', async ({ liveRun, browser }) => {
    const { page } = liveRun;
    const title = `Unshare note ${Date.now()}`;
    const body = 'This note is public, then made private again.';
    await createNote(page, { title, body });

    const shareUrl = await shareNotePublicly(page, title);

    // Fresh, uncached anonymous context: confirms the link works while public.
    await withFencedPage(browser, {}, async (anonPage) => {
        await anonPage.goto(shareUrl);
        await assertTestOrigin(anonPage);
        await expect(anonPage.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 });
        await expect(anonPage.getByRole('article')).toContainText(body);
    }, [liveIdentityOrigin()]);

    await unshareNotePublicly(page, title);

    // A second, separate anonymous context — not a reload of the first — so no
    // client-side query cache can mask the real 401/403 the guest API now returns.
    await withFencedPage(browser, {}, async (anonPage) => {
        await anonPage.goto(shareUrl);
        await assertTestOrigin(anonPage);
        await expect(anonPage.getByRole('heading', { level: 1, name: 'Note Not Found' })).toBeVisible({ timeout: 15_000 });
        await expect(anonPage.getByText('This note is not shared publicly.')).toBeVisible();
        await expect(anonPage.getByRole('heading', { level: 1, name: title })).not.toBeVisible();
    }, [liveIdentityOrigin()]);
});
