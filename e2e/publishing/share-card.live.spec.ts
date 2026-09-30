import type { Page, TestInfo } from '@playwright/test';
import { test, expect, liveIdentityOrigin } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote, shareNotePublicly } from '../support/actions';

// #222: the share dialog's link-card preview, custom description and
// search-indexing toggle, checked against the guest header a logged-out
// reader (and the Pages Function) actually gets. Screenshots go to the folder
// the "E2E live" workflow uploads on every run.

const SCREENSHOT_DIR = 'test-results/share-article-screenshots';
// Copies of JOURNAL_DRIVE (same values as functions/_lib/shareMeta.ts).
const DRIVE_ALIAS = 'd5f411fa83fd4854a3bd7e974cc9bca9';
const DRIVE_TYPE = '30743710039d4b97bbd352f343d1c9df';

type Card = { description?: string; indexable?: boolean };

async function openShareDialog(page: Page, title: string) {
    await assertTestOrigin(page);
    await page.getByRole('button').filter({ hasText: title }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Link preview', { exact: true })).toBeVisible({ timeout: 15_000 });
    return dialog;
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    const path = `${SCREENSHOT_DIR}/${name}.png`;
    await page.screenshot({ path });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('share dialog link card: preview, custom description, indexing (#222)', async ({ liveRun, playwright }, testInfo) => {
    test.setTimeout(240_000);
    const { page } = liveRun;
    const title = `Card note ${Date.now()}`;
    const firstParagraph = 'The first paragraph of this shared note.';
    const custom = `A custom link description ${Date.now()}`;
    await createNote(page, { title, body: firstParagraph });

    // Making a note public before its first upload finishes can fail (#361) — retry.
    let shareUrl = '';
    await expect(async () => {
        await page.keyboard.press('Escape');
        shareUrl = await shareNotePublicly(page, title);
    }).toPass({ timeout: 90_000 });
    const noteId = new URL(shareUrl).pathname.split('/').pop()!;

    // The same guest header request the Pages Function makes, with no session.
    const guest = await playwright.request.newContext({ ignoreHTTPSErrors: true });
    const query = new URLSearchParams({ alias: DRIVE_ALIAS, type: DRIVE_TYPE, clientUniqueId: noteId });
    const headerUrl = `${liveIdentityOrigin()}/api/guest/v1/drive/query/specialized/cuid/header?${query}`;
    const guestCard = async (): Promise<Card | null> => {
        const res = await guest.get(headerUrl, { headers: { accept: 'application/json' } });
        if (res.status() !== 200) return null;
        const raw = (await res.json())?.fileMetadata?.appData?.content;
        const content = typeof raw === 'string' ? JSON.parse(raw) : raw ?? {};
        return content.card ?? {};
    };

    try {
        const dialog = await openShareDialog(page, title);
        const preview = dialog.locator('div.rounded-lg.border').filter({ has: page.locator('img[src="/logo.webp"]') });
        await expect(preview).toContainText(title);
        await expect(preview).toContainText(firstParagraph);

        // Custom description, saved on blur.
        const description = dialog.getByLabel('Description', { exact: true });
        await expect(description).toHaveAttribute('placeholder', firstParagraph);
        await description.fill(custom);
        await description.blur();
        await expect(preview).toContainText(custom);
        await expect.poll(async () => (await guestCard())?.description, { timeout: 60_000 }).toBe(custom);

        // Search indexing on.
        const indexing = dialog.getByRole('switch', { name: 'Allow search engines to index this page' });
        await expect(indexing).not.toBeChecked();
        await indexing.click();
        await expect(indexing).toBeChecked();
        await expect.poll(async () => (await guestCard())?.indexable, { timeout: 60_000 }).toBe(true);
        const afterIndexing = await guestCard();
        testInfo.annotations.push({ type: 'guest card (custom, indexable)', description: JSON.stringify(afterIndexing) });
        console.log(`[share-card] guest header card: ${JSON.stringify(afterIndexing)}`);

        // 375px: full-width preview, no horizontal scroll in the dialog.
        await page.setViewportSize({ width: 375, height: 812 });
        const widths = await dialog.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
        expect.soft(widths.scroll, 'no horizontal scroll in the dialog at 375px').toBeLessThanOrEqual(widths.client);
        await screenshot(page, testInfo, 'share-card-375-custom');

        // "Use first paragraph" clears the custom text.
        await dialog.getByRole('button', { name: 'Use first paragraph' }).click();
        await expect(description).toHaveValue('');
        await expect(preview).toContainText(firstParagraph);
        await expect(preview).not.toContainText(custom);
        await expect.poll(async () => (await guestCard())?.description, { timeout: 60_000 }).toBe(firstParagraph);
        const afterReset = await guestCard();
        testInfo.annotations.push({ type: 'guest card (reset)', description: JSON.stringify(afterReset) });
        console.log(`[share-card] guest header card after reset: ${JSON.stringify(afterReset)}`);
        expect(afterReset?.indexable).toBe(true);
        await screenshot(page, testInfo, 'share-card-375-default');
    } finally {
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width: 1280, height: 720 });
        await guest.dispose();
    }
});
