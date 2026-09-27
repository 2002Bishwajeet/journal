import { test, expect } from '../fixtures';
import { installNetworkFence, assertNoFenceViolations } from '../support/network-fence';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote, shareNotePublicly } from '../support/actions';

test('a public note is readable via its share link with no session', async ({ liveRun, browser }) => {
    const { page } = liveRun;
    const identity = process.env.E2E_LIVE_IDENTITY;
    if (!identity) throw new Error('E2E_LIVE_IDENTITY must be set to run the `live` project.');

    const title = `Public note ${Date.now()}`;
    const body = 'This note is public and readable without signing in.';
    await createNote(page, { title, body });

    const shareUrl = await shareNotePublicly(page, title);

    // Anonymous context: no storage state. Guest reads still hit the real
    // identity's guest API, so it needs the same extra origin allowance.
    const anonContext = await browser.newContext();
    const { violations } = await installNetworkFence(anonContext, [`https://${identity}`]);
    const anonPage = await anonContext.newPage();

    try {
        await anonPage.goto(shareUrl);
        await assertTestOrigin(anonPage);
        await expect(anonPage.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 });
        await expect(anonPage.getByRole('article')).toContainText(body);
    } finally {
        await anonContext.close();
    }
    assertNoFenceViolations(violations);
});
