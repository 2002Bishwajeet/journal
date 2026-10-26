import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// An iPhone's Homebase refused image uploads with "ThumbnailDescriptor BytesWritten 1678832
// too long, max 1048576": Safari can't encode webp, its canvas returns png (which ignores
// quality), so a 1600px thumbnail of a large png was over the server's 1 MiB limit.
// Here the canvas behaves like Safari's and the "server" refuses any thumbnail over 1 MiB.

const NOTE_ID = '00000000-0000-4000-8000-000000000001';
const MAX_THUMBNAIL_BYTES = 1024 * 1024;

const noteHeader = {
    fileId: 'seeded-remote-note',
    fileState: 'active',
    fileSystemType: 'Standard',
    fileMetadata: {
        isEncrypted: false,
        versionTag: 'seeded-version',
        created: 1,
        updated: 1,
        payloads: [],
        appData: { uniqueId: NOTE_ID, fileType: 605, dataType: 0, content: JSON.stringify({ title: 'Screenshots' }) },
    },
    serverMetadata: { accessControlList: { requiredSecurityGroup: 'Owner' } },
    sharedSecretEncryptedKeyHeader: { iv: '', encryptedAesKey: '', encryptionVersion: 1, type: 11 },
};

/** The size of each multipart part named `name`. */
function partSizes(body: Buffer, contentType: string, name: string): number[] {
    const boundary = Buffer.from(`--${/boundary=(.+)$/.exec(contentType)![1]}`);
    const sizes: number[] = [];
    let start = body.indexOf(boundary);
    while (start !== -1) {
        const next = body.indexOf(boundary, start + boundary.length);
        if (next === -1) break;
        const part = body.subarray(start + boundary.length, next);
        const headerEnd = part.indexOf('\r\n\r\n');
        if (part.subarray(0, headerEnd).toString().includes(`name="${name}"`)) {
            sizes.push(part.length - headerEnd - 4 - 2); // minus the blank line and the trailing CRLF
        }
        start = next;
    }
    return sizes;
}

test('a large png uploads with every thumbnail at or under 1 MiB where webp can\'t be encoded', async ({ app }) => {
    test.slow();
    await assertTestOrigin(app);

    const thumbnailSizes: number[][] = [];
    await app.route('**/drive/query/specialized/cuid/header**', (route) => route.fulfill({ json: noteHeader }));
    await app.route('**/drive/files/update**', (route) => {
        const request = route.request();
        const sizes = partSizes(request.postDataBuffer()!, request.headers()['content-type'], 'thumbnail');
        thumbnailSizes.push(sizes);
        const tooLong = sizes.find((size) => size > MAX_THUMBNAIL_BYTES);
        if (tooLong) {
            return route.fulfill({
                status: 400,
                json: {
                    title: `ThumbnailDescriptor BytesWritten ${tooLong} too long, max ${MAX_THUMBNAIL_BYTES}`,
                    status: 400,
                    errorCode: 'unhandledScenario',
                },
            });
        }
        return route.fulfill({
            json: { newVersionTag: 'uploaded-version', file: { fileId: 'seeded-remote-note' }, globalTransitId: null, recipientStatus: {} },
        });
    });

    await app.evaluate(async () => {
        // Safari: a webp request silently gives png
        const toBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
            return toBlob.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality);
        };
        const convertToBlob = OffscreenCanvas.prototype.convertToBlob;
        OffscreenCanvas.prototype.convertToBlob = function (options) {
            return convertToBlob.call(this, options?.type === 'image/webp' ? { ...options, type: 'image/png' } : options);
        };

        // A 3000x3000 noise png: it barely compresses, like a detailed screenshot or photo
        const canvas = new OffscreenCanvas(3000, 3000);
        const ctx = canvas.getContext('2d')!;
        const pixels = ctx.createImageData(3000, 3000);
        const words = new Uint32Array(pixels.data.buffer);
        for (let i = 0; i < words.length; i++) words[i] = (Math.random() * 0xffffffff) | 0xff000000;
        ctx.putImageData(pixels, 0, 0);
        const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());

        // seedImageUploads copies each entry into a Uint8Array
        await window.__journalE2E!.seedImageUploads('Screenshots', [png as unknown as number[]]);
        await window.__journalE2E!.uploadPendingImages();
    });

    // One upload, accepted: the tiny thumb and all four sizes, none over 1 MiB
    expect(thumbnailSizes).toHaveLength(1);
    expect(thumbnailSizes[0]).toHaveLength(5);
    for (const size of thumbnailSizes[0]) expect(size).toBeLessThanOrEqual(MAX_THUMBNAIL_BYTES);
});
