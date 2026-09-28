import { test, expect, waitForAppReady, withFencedPage, liveIdentityOrigin, LIVE_STORAGE_STATE } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote, openNote, selectFolder, activeEditor } from '../support/actions';

// A tiny (16x16, solid color) PNG — generated here rather than a binary
// fixture file, and small enough to skip prepareImageForUpload's re-encode
// path (see planImageIngest's PNG "keep" branch) for a fast upload. Not a 1x1
// pixel: a real thumbnail-generation pipeline runs on the actual pixel size,
// and a degenerate 1x1 source isn't representative of a real photo.
const TINY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGM4YWREEmIY1TCqYfhqAAAUBCwQ4b89uwAAAABJRU5ErkJggg==';

test('an image added to a note uploads and downloads on a second device', async ({ liveRun, browser }) => {
    // The default 30s test timeout is smaller than the two real-network waits
    // below (upload settling, then the download on device B) combined.
    test.setTimeout(90_000);

    const { page: pageA, folderName } = liveRun;
    const title = `Live image ${Date.now()}`;
    await createNote(pageA, { title, body: 'A note with an image.' });

    const fileChooserPromise = pageA.waitForEvent('filechooser');
    await pageA.getByRole('button', { name: 'Add Image' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
        name: 'tiny.png',
        mimeType: 'image/png',
        buffer: Buffer.from(TINY_PNG_BASE64, 'base64'),
    });

    // The image node shows "Uploading…" (see usePendingImage) until the real
    // upload finishes and the node is promoted to an attachment:// src — wait
    // for it to appear first, so a fast upload can't be mistaken for one that
    // never started, then wait for it to clear.
    await expect(pageA.getByText('Uploading…')).toBeVisible({ timeout: 10_000 });
    await expect(pageA.getByText('Uploading…')).toBeHidden({ timeout: 30_000 });
    // "Uploading…" also disappears on a failed upload (replaced by "Upload
    // failed") — fail here with a clear reason rather than timing out later
    // waiting for an image that will never arrive on device B.
    await expect(pageA.getByText('Upload failed')).not.toBeVisible();

    // Device B: a second context on the same real identity, opening the note
    // only after the upload above has settled — no realtime-image race to ride out.
    await withFencedPage(browser, { storageState: LIVE_STORAGE_STATE }, async (pageB) => {
        await pageB.goto('/');
        await assertTestOrigin(pageB);
        await waitForAppReady(pageB);
        await selectFolder(pageB, folderName);
        await openNote(pageB, title);

        // Device B has no local copy, so this <img> is the real download from
        // the server (OdinImage), not the uploader's own local blob.
        const image = activeEditor(pageB).locator('.image-node img').last();
        await expect.poll(
            () => image.evaluate((el) => (el as HTMLImageElement).naturalWidth),
            { timeout: 30_000 },
        ).toBeGreaterThan(0);
    }, [liveIdentityOrigin()]);
});
