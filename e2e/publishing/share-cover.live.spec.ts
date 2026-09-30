import { request, type Page, type TestInfo } from '@playwright/test';
import { test, expect, withFencedPage, liveIdentityOrigin } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote, shareNotePublicly } from '../support/actions';
import { makeSolidPng } from '../support/png';
import { buildHeadTags, fetchShareMeta } from '../../functions/_lib/shareMeta';

// #220: a public note's cover renders on the share page for a logged-out
// reader, and the og:image URL the share Pages Function emits for it (the
// guest thumb endpoint) serves an image anonymously. Screenshots land in
// SCREENSHOT_DIR, which the "E2E live" workflow uploads on every run.

const SCREENSHOT_DIR = 'test-results/share-cover-screenshots';
const RED: [number, number, number] = [200, 50, 50];

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    const path = `${SCREENSHOT_DIR}/${name}.png`;
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('share page shows the cover, and its og:image is served anonymously (#220)', async ({ liveRun, browser }, testInfo) => {
    test.setTimeout(300_000);
    const { page } = liveRun;
    const identity = new URL(liveIdentityOrigin()).hostname;
    const title = `Cover share note ${Date.now()}`;
    await createNote(page, { title, body: 'A shared note with a cover image.' });

    // Add a cover and wait until it's uploaded (OdinImage's <img crossorigin> replaces the local blob).
    await assertTestOrigin(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add cover' }).click();
    await (await chooser).setFiles({ name: 'cover.png', mimeType: 'image/png', buffer: makeSolidPng(800, 600, RED) });
    const band = page.getByRole('img', { name: 'Note cover' });
    await expect(band.locator('img[crossorigin]').last()).toBeAttached({ timeout: 120_000 });

    // Making a note public before its upload lands fails with "Note with uniqueId … not found" (#361) — retry.
    let shareUrl = '';
    await expect(async () => {
        await page.keyboard.press('Escape');
        shareUrl = await shareNotePublicly(page, title);
    }).toPass({ timeout: 90_000 });
    const noteId = new URL(shareUrl).pathname.split('/').pop()!;

    // Logged out: no storageState, and a request context of its own (the live project's carries the owner's cookies).
    const anon = await request.newContext({ ignoreHTTPSErrors: true });
    try {
        // The og:image the share Function emits: its own header read + tag builder, fed through the anonymous context.
        const anonFetch = (async (url: string | URL | Request) => {
            const res = await anon.get(String(url), { maxRedirects: 0, failOnStatusCode: false });
            const body = [204, 205, 304].includes(res.status()) ? null : await res.text();
            return new Response(body, { status: res.status(), headers: res.headers() });
        }) as typeof fetch;
        let ogImage = '';
        await expect.poll(async () => {
            const meta = await fetchShareMeta(identity, noteId, anonFetch);
            const tags = meta ? buildHeadTags(meta, shareUrl, new URL(shareUrl).origin) : '';
            ogImage = /<meta property="og:image" content="([^"]+)"/.exec(tags)?.[1].replace(/&amp;/g, '&') ?? '';
            return ogImage;
        }, { timeout: 90_000, message: 'og:image is the guest thumb URL of the cover' })
            .toMatch(new RegExp(`^https://${identity.replace(/\./g, '\\.')}/api/guest/v1/drive/files/thumb\\?.*payloadKey=jrnl_img\\d+`));

        const thumb = await anon.get(ogImage, { failOnStatusCode: false });
        const contentType = thumb.headers()['content-type'] ?? '';
        const bytes = (await thumb.body()).length;
        testInfo.annotations.push({ type: 'anonymous og:image fetch', description: `${ogImage} -> ${thumb.status()} ${contentType} ${bytes}B` });
        console.log(`[share-cover] GET ${ogImage} -> ${thumb.status()} ${contentType} ${bytes}B`);
        expect(thumb.status()).toBe(200);
        expect(contentType).toMatch(/^image\//);
        expect(bytes).toBeGreaterThan(0);
    } finally {
        await anon.dispose();
    }

    await withFencedPage(browser, { viewport: { width: 1280, height: 800 } }, async (anonPage) => {
        // The cover sits above the article, outside it. The promoted (attachment://) cover
        // reaches the server's content payload on the sync after its upload: reload until it's there.
        const cover = anonPage.locator('main > div img.object-cover');
        await expect(async () => {
            await anonPage.goto(shareUrl);
            await assertTestOrigin(anonPage);
            await expect(anonPage.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 });
            await expect(cover).toBeVisible({ timeout: 15_000 });
        }).toPass({ timeout: 90_000 });
        await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0), { timeout: 30_000 })
            .toBeGreaterThan(0);
        await screenshot(anonPage, testInfo, 'share-cover-desktop');

        await anonPage.setViewportSize({ width: 375, height: 812 });
        await expect(cover).toBeVisible();
        expect(await anonPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await screenshot(anonPage, testInfo, 'share-cover-375');
    }, [liveIdentityOrigin()]);
});
