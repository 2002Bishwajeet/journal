import { deflateSync } from 'node:zlib';
import { test, expect, waitForAppReady, withFencedPage, liveIdentityOrigin, LIVE_STORAGE_STATE } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote, openNote, selectFolder, activeEditor } from '../support/actions';

// A small PNG encoder for a solid-color image, generated here rather than a
// binary fixture file. 800x600 (a realistic photo size) rather than a 1x1 or
// 16x16 pixel test fixture: a degenerate source image made the server
// generate several identically-sized thumbnails, which 500'd a real upload.
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    return table;
})();

function crc32(buf: Buffer): number {
    let crc = -1;
    for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}

function makeSolidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // color type: RGB

    const rowLen = 1 + width * 3; // leading filter byte (0) per scanline
    const raw = Buffer.alloc(rowLen * height);
    for (let y = 0; y < height; y++) {
        const rowStart = y * rowLen + 1;
        for (let x = 0; x < width; x++) {
            raw[rowStart + x * 3] = rgb[0];
            raw[rowStart + x * 3 + 1] = rgb[1];
            raw[rowStart + x * 3 + 2] = rgb[2];
        }
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

test('an image added to a note uploads and downloads on a second device', async ({ liveRun, browser }) => {
    // The default 30s test timeout is smaller than the two real-network waits
    // below (upload settling, then the download on device B) combined.
    test.setTimeout(120_000);

    const { page: pageA, folderName } = liveRun;
    const title = `Live image ${Date.now()}`;
    await createNote(pageA, { title, body: 'A note with an image.' });

    const fileChooserPromise = pageA.waitForEvent('filechooser');
    await pageA.getByRole('button', { name: 'Add Image' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
        name: 'photo.png',
        mimeType: 'image/png',
        buffer: makeSolidPng(800, 600, [200, 50, 50]),
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
