import type { ConsoleMessage, Locator, Page, TestInfo } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage, liveIdentityOrigin, LIVE_STORAGE_STATE } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { activeTitleInput, createFolder, createNote, selectFolder, shareNotePublicly } from '../support/actions';
import { makeSolidPng } from '../support/png';

// #219: the owner adds, repositions, changes and removes a note's cover on a
// real identity; cover and position survive a reload, and changing the cover
// queues the old payload for deletion (observable only as SyncService's
// "Deleting payloads" console line, so the spec turns on the debug flag). Screenshots land in SCREENSHOT_DIR, which
// the "E2E live" workflow uploads on every run.

const SCREENSHOT_DIR = 'test-results/cover-screenshots';
const RED: [number, number, number] = [200, 50, 50];
const BLUE: [number, number, number] = [40, 80, 200];

const band = (page: Page) => page.getByRole('img', { name: 'Note cover' });
// The role="img" layer is pointer-events-none; hover and drag its container instead.
const bandFrame = (page: Page) => band(page).locator('..');

// The cover's <img> as uploaded (OdinImage sets crossorigin; the pending blob <img> doesn't).
const uploadedImg = (page: Page) => band(page).locator('img[crossorigin]').last();

async function pickCover(page: Page, button: Locator, rgb: [number, number, number]): Promise<void> {
    await assertTestOrigin(page);
    const chooser = page.waitForEvent('filechooser');
    await button.click();
    await (await chooser).setFiles({ name: 'cover.png', mimeType: 'image/png', buffer: makeSolidPng(800, 600, rgb) });
}

// Centre pixel of the cover's largest decoded <img>, or null if none has decoded yet.
function coverPixel(page: Page): Promise<number[] | null> {
    return band(page).evaluate((el) => {
        const img = [...el.querySelectorAll('img')]
            .filter((i) => i.complete && i.naturalWidth > 0)
            .sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
        if (!img) return null;
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.drawImage(img, img.naturalWidth / 2, img.naturalHeight / 2, 1, 1, 0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    });
}

// Whether the cover currently shows the solid colour `rgb`.
async function coverIs(page: Page, rgb: [number, number, number]): Promise<boolean> {
    const px = await coverPixel(page);
    return !!px && px.every((v, i) => Math.abs(v - rgb[i]) <= 12);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    const path = `${SCREENSHOT_DIR}/${name}.png`;
    await page.waitForTimeout(300); // let the toolbar's duration-200 hover fade finish
    await page.screenshot({ path });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

// Local Yjs/PGlite persistence is async (see typeInEditor) — let it settle before reloading.
async function reloadNote(page: Page): Promise<void> {
    await page.waitForTimeout(1500);
    await page.reload();
    await assertTestOrigin(page);
    await waitForAppReady(page);
}

test('cover image: add, reposition, change and remove survive reloads (#219)', async ({ liveRun }, testInfo) => {
    test.setTimeout(300_000);
    const { page, folderName } = liveRun;

    // SyncService's console lines, with array args resolved to JSON.
    const syncLogs: Promise<unknown[]>[] = [];
    const onConsole = (msg: ConsoleMessage) => {
        if (!msg.text().startsWith('[SyncService]')) return;
        syncLogs.push(Promise.all(msg.args().map((a) => a.jsonValue().catch(() => null))));
    };
    const logged = async (match: (args: unknown[]) => boolean) =>
        (await Promise.all(syncLogs)).find(match);
    const uploadedKeys = async () =>
        (await Promise.all(syncLogs))
            .map((args) => /uploaded as (jrnl_img\d+)$/.exec(String(args[0]))?.[1])
            .filter((k): k is string => !!k);
    page.on('console', onConsole);

    try {
        // Production builds silence console.log unless Homebase's debug flag is set (initLogging.ts).
        await page.evaluate(() => localStorage.setItem('debug', '1'));
        await reloadNote(page);
        await selectFolder(page, folderName);

        const title = `Cover note ${Date.now()}`;
        await createNote(page, { title, body: 'A note with a cover image.' });
        await expect(band(page)).toHaveCount(0);
        await page.getByRole('button', { name: 'Add cover' }).hover();
        await screenshot(page, testInfo, 'cover-none-desktop-light');

        // Add: the local blob shows at once, then the upload promotes it to an attachment.
        await pickCover(page, page.getByRole('button', { name: 'Add cover' }), RED);
        await expect(band(page)).toBeVisible();
        await expect.poll(() => coverIs(page, RED), { timeout: 10_000 }).toBe(true);
        await expect.poll(uploadedKeys, { timeout: 120_000, message: 'cover uploaded as a jrnl_img payload' })
            .toHaveLength(1);
        const [firstKey] = await uploadedKeys();
        await expect(uploadedImg(page)).toBeAttached({ timeout: 30_000 });

        // Reposition: drag up a quarter of the band height, 50 -> 75.
        await bandFrame(page).hover();
        await page.getByRole('button', { name: 'Reposition cover' }).click();
        const box = (await bandFrame(page).boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y - box.height / 4, { steps: 5 });
        await page.mouse.up();
        await expect(band(page)).toHaveAttribute('style', /--cover-y:\s*75%/);
        await page.getByRole('button', { name: 'Done repositioning' }).click();

        // Reload: the uploaded cover renders from the server with its position.
        await reloadNote(page);
        await expect(band(page)).toBeVisible({ timeout: 15_000 });
        await expect(band(page)).toHaveAttribute('style', /--cover-y:\s*75%/);
        await expect.poll(() => uploadedImg(page).evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 30_000 })
            .toBeGreaterThan(0);
        await expect.poll(() => coverIs(page, RED)).toBe(true);

        // Change: the new image shows, uploads under a new key, and the old key is deleted on sync.
        await bandFrame(page).hover();
        await pickCover(page, page.getByRole('button', { name: 'Change cover' }), BLUE);
        await expect.poll(() => coverIs(page, BLUE), { timeout: 10_000 }).toBe(true);
        await expect.poll(uploadedKeys, { timeout: 120_000, message: 'new cover uploaded' }).toHaveLength(2);
        // A reused key would keep showing the old image from every client's image cache.
        const [, secondKey] = await uploadedKeys();
        expect(secondKey).not.toBe(firstKey);
        await expect(uploadedImg(page)).toBeAttached({ timeout: 30_000 });
        await expect.poll(() => coverIs(page, BLUE), { timeout: 30_000 }).toBe(true);

        // The promoted doc (and the held deletion) goes out on the next sync; a reload runs one.
        await reloadNote(page);
        await expect.poll(
            async () => !!(await logged((args) =>
                String(args[0]).startsWith('[SyncService] Deleting payloads')
                && Array.isArray(args[1]) && args[1].includes(firstKey))),
            { timeout: 60_000, message: `old cover payload ${firstKey} deleted on sync` },
        ).toBe(true);
        await expect(band(page)).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => uploadedImg(page).evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 30_000 })
            .toBeGreaterThan(0);
        await expect.poll(() => coverIs(page, BLUE), { timeout: 30_000 }).toBe(true);

        // Evidence: cover and reposition mode, light/dark, desktop/375px.
        for (const colorScheme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme });
            if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
            else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
            for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['375', { width: 375, height: 812 }]] as const) {
                await page.setViewportSize(viewport);
                await expect(band(page)).toBeVisible();
                await expect.poll(() => coverIs(page, BLUE), { timeout: 30_000 }).toBe(true);
                await bandFrame(page).hover();
                await screenshot(page, testInfo, `cover-${label}-${colorScheme}`);
                await page.getByRole('button', { name: 'Reposition cover' }).click();
                await screenshot(page, testInfo, `cover-reposition-${label}-${colorScheme}`);
                await page.getByRole('button', { name: 'Done repositioning' }).click();
            }
        }
        await page.emulateMedia({ colorScheme: 'light' });
        await page.setViewportSize({ width: 1280, height: 720 });

        // Remove: gone now and after a reload.
        await bandFrame(page).hover();
        await page.getByRole('button', { name: 'Remove cover' }).click();
        await expect(band(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Add cover' })).toBeAttached();
        await reloadNote(page);
        await expect(activeTitleInput(page)).toHaveValue(title, { timeout: 15_000 });
        await expect(band(page)).toHaveCount(0);
    } finally {
        page.off('console', onConsole);
        await page.evaluate(() => localStorage.removeItem('debug')).catch(() => {});
        // liveRun's page is shared with later specs: leave it as the fixture made it.
        await page.emulateMedia({ colorScheme: 'light' });
        await page.setViewportSize({ width: 1280, height: 720 });
        await selectFolder(page, folderName).catch(() => {});
    }
});

// #444: OdinImage sizes its request from device pixels, so on a 2x screen a cover is sharp in
// the editor band and in the Share dialog's link preview. Own context: the shared liveRun page
// is a 1x one, and deviceScaleFactor is fixed per context.
test('cover image is sharp on a 2x screen in the band and the share preview (#444)', async ({ browser }, testInfo) => {
    test.setTimeout(300_000);
    const folderName = `${process.env.E2E_LIVE_RUN_FOLDER}-w${testInfo.workerIndex}-dpr2`;
    const options = {
        storageState: LIVE_STORAGE_STATE,
        viewport: { width: 1900, height: 1000 },
        deviceScaleFactor: 2,
    };

    await withFencedPage(browser, options, async (page) => {
        await page.goto('/');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await createFolder(page, folderName);
        await selectFolder(page, folderName);

        const title = `Cover dpr2 note ${Date.now()}`;
        await createNote(page, { title, body: 'A note with a big cover image.' });
        await assertTestOrigin(page);
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Add cover' }).click();
        await (await chooser).setFiles({ name: 'cover.png', mimeType: 'image/png', buffer: makeSolidPng(3200, 1200, RED) });
        await expect(uploadedImg(page)).toBeAttached({ timeout: 120_000 });

        // The shared check: the <img> has at least the pixels its box shows on a 2x screen, up to the original's 3200.
        const isSharp = (img: Locator) => img.evaluate((i: HTMLImageElement) =>
            i.complete && i.naturalWidth >= Math.min(i.clientWidth * window.devicePixelRatio, 3200));

        await reloadNote(page);
        await expect(band(page)).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => isSharp(uploadedImg(page)), { timeout: 30_000, message: 'band cover has 2x pixels' }).toBe(true);
        await screenshot(page, testInfo, 'cover-band-light-1900x1000-dpr2');

        // Share dialog: making a note public before its upload lands fails (#361) — retry.
        await expect(async () => {
            await page.keyboard.press('Escape');
            await shareNotePublicly(page, title);
        }).toPass({ timeout: 90_000 });
        await page.getByRole('button').filter({ hasText: title }).first().click({ button: 'right' });
        await page.getByRole('menuitem', { name: 'Share' }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.getByText('Link preview', { exact: true })).toBeVisible({ timeout: 15_000 });
        // The preview is the generated 1200×630 card image (#441), shown as a blob: URL.
        const preview = dialog.locator('img[src^="blob:"]');
        await expect.poll(() => isSharp(preview), { timeout: 60_000, message: 'share preview has 2x pixels' }).toBe(true);
        await screenshot(page, testInfo, 'cover-share-preview-light-1900x1000-dpr2');
        await page.keyboard.press('Escape');
    }, [liveIdentityOrigin()]);
});
