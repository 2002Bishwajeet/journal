import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { request, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { test, expect, withFencedPage, liveIdentityOrigin } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote, shareNotePublicly } from '../support/actions';
import { makeBannerPng, makeSolidPng } from '../support/png';
import { buildHeadTags, fetchShareMeta } from '../../functions/_lib/shareMeta';

// #220: a public note's cover renders on the share page for a logged-out
// reader, and the og:image URL the share Pages Function emits for it (the
// note's 1200×630 card image payload, #441) serves an image anonymously.
// Screenshots land in SCREENSHOT_DIR, which the "E2E live" workflow uploads on every run.

const SCREENSHOT_DIR = 'test-results/share-cover-screenshots';
const RED: [number, number, number] = [200, 50, 50];

const CARD_IMAGE_URL = /\/api\/guest\/v1\/drive\/files\/payload\?.*key=jrnl_card/;

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    const path = `${SCREENSHOT_DIR}/${name}.png`;
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** Add a cover to the open note and wait until it's uploaded (OdinImage's <img crossorigin> replaces the local blob). */
async function addCover(page: Page, png: Buffer): Promise<void> {
    await assertTestOrigin(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add cover' }).click();
    await (await chooser).setFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png });
    const band = page.getByRole('img', { name: 'Note cover' });
    await expect(band.locator('img[crossorigin]').last()).toBeAttached({ timeout: 120_000 });
}

/** Make the note public, retrying: before its upload lands this fails with "Note with uniqueId … not found" (#361). */
async function publish(page: Page, title: string): Promise<string> {
    let shareUrl = '';
    await expect(async () => {
        await page.keyboard.press('Escape');
        shareUrl = await shareNotePublicly(page, title);
    }).toPass({ timeout: 90_000 });
    return shareUrl;
}

/** The head tags the share Function emits: its own header read + tag builder, fed through an anonymous context. */
async function shareHeadTags(anon: APIRequestContext, shareUrl: string): Promise<string> {
    const identity = new URL(liveIdentityOrigin()).hostname;
    const noteId = new URL(shareUrl).pathname.split('/').pop()!;
    const anonFetch = (async (url: string | URL | Request) => {
        const res = await anon.get(String(url), { maxRedirects: 0, failOnStatusCode: false });
        const body = [204, 205, 304].includes(res.status()) ? null : await res.text();
        return new Response(body, { status: res.status(), headers: res.headers() });
    }) as typeof fetch;
    const meta = await fetchShareMeta(identity, noteId, anonFetch);
    return meta ? buildHeadTags(meta, shareUrl, new URL(shareUrl).origin) : '';
}

const metaContent = (tags: string, property: string) =>
    new RegExp(`<meta property="${property}" content="([^"]+)"`).exec(tags)?.[1].replace(/&amp;/g, '&') ?? '';

/** Wait for the share head's og:image to be the 1200×630 card image, and fetch it logged out. */
async function fetchOgImage(shareUrl: string): Promise<Buffer> {
    const anon = await request.newContext({ ignoreHTTPSErrors: true });
    try {
        let tags = '';
        await expect.poll(async () => {
            tags = await shareHeadTags(anon, shareUrl);
            return metaContent(tags, 'og:image');
        }, { timeout: 90_000, message: "og:image is the note's card image payload" }).toMatch(CARD_IMAGE_URL);
        expect(metaContent(tags, 'og:image:width')).toBe('1200');
        expect(metaContent(tags, 'og:image:height')).toBe('630');

        const og = await anon.get(metaContent(tags, 'og:image'), { failOnStatusCode: false });
        expect(og.status()).toBe(200);
        expect(og.headers()['content-type']).toMatch(/^image\/jpeg/);
        return await og.body();
    } finally {
        await anon.dispose();
    }
}

test('share page shows the cover, and its og:image is served anonymously (#220)', async ({ liveRun, browser }, testInfo) => {
    test.setTimeout(300_000);
    const { page } = liveRun;
    const identity = new URL(liveIdentityOrigin()).hostname;
    const title = `Cover share note ${Date.now()}`;
    await createNote(page, { title, body: 'A shared note with a cover image.' });

    await addCover(page, makeSolidPng(800, 600, RED));
    const shareUrl = await publish(page, title);

    // Logged out: no storageState, and a request context of its own (the live project's carries the owner's cookies).
    const anon = await request.newContext({ ignoreHTTPSErrors: true });
    try {
        let ogImage = '';
        await expect.poll(async () => {
            ogImage = metaContent(await shareHeadTags(anon, shareUrl), 'og:image');
            return ogImage;
        }, { timeout: 90_000, message: "og:image is the note's card image payload" })
            .toMatch(CARD_IMAGE_URL);
        expect(ogImage.startsWith(`https://${identity}/`)).toBe(true);

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

test('a wide banner cover gets a whole-width 1200×630 card image, and the dialog previews that image (#441)', async ({ liveRun }, testInfo) => {
    test.setTimeout(300_000);
    const { page } = liveRun;
    const title = `Banner card note ${Date.now()}`;
    await createNote(page, { title, body: 'A shared note with a wide banner cover.' });
    // 3:1, with "text" (blue) at both edges that a side crop would cut off.
    const EDGE: [number, number, number] = [30, 60, 220];
    const MIDDLE: [number, number, number] = [240, 200, 40];
    await addCover(page, makeBannerPng(2400, 800, EDGE, MIDDLE));
    const shareUrl = await publish(page, title);

    const ogBytes = await fetchOgImage(shareUrl);
    const ogPath = testInfo.outputPath('og-image-banner.jpg');
    await writeFile(ogPath, ogBytes);
    await testInfo.attach('og-image-banner', { path: ogPath, contentType: 'image/jpeg' });

    await assertTestOrigin(page);
    await page.getByRole('button').filter({ hasText: title }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Link preview', { exact: true })).toBeVisible({ timeout: 15_000 });
    const preview = dialog.locator('img[src^="blob:"]');
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => (img.complete ? [img.naturalWidth, img.naturalHeight] : [0, 0])),
        { timeout: 60_000, message: 'the preview is the 1200×630 card image' }).toEqual([1200, 630]);

    // The preview is the uploaded card image, byte for byte, and shows the banner's full width.
    const shown = await preview.evaluate(async (img: HTMLImageElement) => {
        const bytes = await (await fetch(img.src)).arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
        const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const at = (x: number) => [...ctx.getImageData(x, 315, 1, 1).data.slice(0, 3)];
        return { hash, left: at(8), middle: at(600), right: at(1191) };
    });
    expect(shown.hash).toBe(createHash('sha256').update(ogBytes).digest('hex'));
    const near = (rgb: number[], want: [number, number, number]) => rgb.every((v, i) => Math.abs(v - want[i]) < 40);
    expect(near(shown.left, EDGE), `left edge ${shown.left}`).toBe(true);
    expect(near(shown.right, EDGE), `right edge ${shown.right}`).toBe(true);
    expect(near(shown.middle, MIDDLE), `middle ${shown.middle}`).toBe(true);

    for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        await preview.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`share-dialog-banner-preview-${colorScheme}-1280.png`) });
    }
    await page.emulateMedia({ colorScheme: null });
    await page.keyboard.press('Escape');
});
