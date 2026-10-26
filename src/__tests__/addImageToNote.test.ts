/**
 * Regression: addImageToNote carried the repo's scariest TODO
 * (`//TODO: This corrupts the previous note data`). Two verified defects:
 *   1. The new payload key was derived from the COUNT of existing jrnl_img*
 *      payloads, so after a deletion (jrnl_img0, jrnl_img2 → count 2) the next
 *      key `jrnl_img2` silently overwrote an existing image. It must be derived
 *      from the max index instead.
 *   2. isEncrypted:true + Owner ACL were hardcoded and the key header was passed
 *      unconditionally, so adding an image to a PUBLIC note re-encrypted it and
 *      reverted the share (and a collaborative note lost its circle ACL). The
 *      encryption/ACL/keyHeader must mirror the existing file header.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { HomebaseFile, EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import { fakeDotYouClient } from './fakes';
import { SecurityGroupType } from '@homebase-id/js-lib/core';
import type { NoteFileContent } from '@/types';

const { mockPatch, mockGetHeader, mockCreateThumbnails } = vi.hoisted(() => ({
    mockPatch: vi.fn(),
    mockGetHeader: vi.fn(),
    mockCreateThumbnails: vi.fn(),
}));

vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return { ...actual, patchFile: mockPatch, getFileHeaderByUniqueId: mockGetHeader };
});
vi.mock('@homebase-id/js-lib/media', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/media')>();
    return { ...actual, createThumbnails: mockCreateThumbnails };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { MAX_PREVIEW_BYTES, MAX_THUMBNAIL_BYTES } from '@/lib/homebase/noteImagePayloads';

const NOTE_ID = '11111111-1111-1111-1111-111111111111';
const fakeClient = fakeDotYouClient();
const fakeKeyHeader = { encryptionVersion: 1 } as unknown as EncryptedKeyHeader;

// patchFile args: (client, keyHeader, instructions, uploadMetadata, payloads, thumbnails)
const keyHeaderArg = () => mockPatch.mock.calls[0][1];
const uploadMeta = () => mockPatch.mock.calls[0][3];
const payloadsArg = () => mockPatch.mock.calls[0][4];
const thumbnailsArg = () => mockPatch.mock.calls[0][5];

const imageBlob = () => ({
    file: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    filename: 'x.png',
});

function header(over: {
    payloadKeys?: string[];
    isEncrypted?: boolean;
    content?: NoteFileContent | string;
}): HomebaseFile<NoteFileContent> {
    const payloads = (over.payloadKeys ?? []).map((key) => ({ key }));
    return {
        fileId: 'file-1',
        sharedSecretEncryptedKeyHeader: fakeKeyHeader,
        fileMetadata: {
            versionTag: 'v-existing',
            isEncrypted: over.isEncrypted ?? true,
            payloads,
            appData: {
                uniqueId: NOTE_ID,
                groupId: 'group-1',
                fileType: 605,
                dataType: 706,
                userDate: 123,
                tags: [],
                content: over.content ?? ({ title: 'Note' } as NoteFileContent),
            },
        },
    } as unknown as HomebaseFile<NoteFileContent>;
}

describe('NotesDriveProvider.addImageToNote', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockPatch.mockResolvedValue({ newVersionTag: 'v2' });
        mockCreateThumbnails.mockResolvedValue({
            additionalThumbnails: [],
            tinyThumb: { pixelWidth: 1, pixelHeight: 1, contentType: 'image/png', content: '' },
        });
        provider = new NotesDriveProvider(fakeClient);
    });

    it('does not reuse a deleted image\'s payload key (max index, not count)', async () => {
        // jrnl_img1 was deleted → jrnl_img0, jrnl_img2 remain. Count-based logic
        // would pick jrnl_img2 and overwrite; max-index must pick jrnl_img3.
        mockGetHeader.mockResolvedValue(
            header({ payloadKeys: ['jrnl_txt', 'jrnl_img0', 'jrnl_img2'], isEncrypted: true })
        );

        const { payloadKey } = await provider.addImageToNote(NOTE_ID, 'v1', imageBlob());

        expect(payloadKey).toBe('jrnl_img3');
        expect(payloadsArg()[0].key).toBe('jrnl_img3');
    });

    it('never goes below the note\'s key counter, so a deleted top key is not reused (#373)', async () => {
        // jrnl_img1 (the top key) was deleted; the max of what's left would hand it out again
        mockGetHeader.mockResolvedValue(
            header({ payloadKeys: ['jrnl_txt', 'jrnl_img0'], isEncrypted: true })
        );

        const { payloadKey } = await provider.addImageToNote(NOTE_ID, 'v1', imageBlob(), 2);

        expect(payloadKey).toBe('jrnl_img2');
    });

    it('ignores the link-card image payload when picking the next image key (#441)', async () => {
        mockGetHeader.mockResolvedValue(
            header({ payloadKeys: ['jrnl_txt', 'jrnl_img0', 'jrnl_card', 'jrnl_img1'], isEncrypted: false })
        );

        const { payloadKey } = await provider.addImageToNote(NOTE_ID, 'v1', imageBlob());

        expect(payloadKey).toBe('jrnl_img2');
    });

    it('keeps a public note unencrypted, Anonymous, with no key header', async () => {
        mockGetHeader.mockResolvedValue(
            header({
                payloadKeys: ['jrnl_img0'],
                isEncrypted: false,
                content: JSON.stringify({ title: 'x', isPublic: true }),
            })
        );

        await provider.addImageToNote(NOTE_ID, 'v1', imageBlob());

        expect(uploadMeta().isEncrypted).toBe(false);
        expect(uploadMeta().accessControlList.requiredSecurityGroup).toBe(SecurityGroupType.Anonymous);
        expect(keyHeaderArg()).toBeUndefined();
    });

    it('shares a collaborative note\'s image with its circle (Connected ACL)', async () => {
        mockGetHeader.mockResolvedValue(
            header({
                payloadKeys: [],
                isEncrypted: true,
                content: { title: 'x', isCollaborative: true, circleIds: ['circle-1'] } as NoteFileContent,
            })
        );

        await provider.addImageToNote(NOTE_ID, 'v1', imageBlob());

        expect(uploadMeta().isEncrypted).toBe(true);
        expect(uploadMeta().accessControlList.requiredSecurityGroup).toBe(SecurityGroupType.Connected);
        expect(uploadMeta().accessControlList.circleIdList).toEqual(['circle-1']);
    });

    it('keeps a private note encrypted and Owner-only, with the key header', async () => {
        mockGetHeader.mockResolvedValue(
            header({ payloadKeys: ['jrnl_img0'], isEncrypted: true, content: { title: 'x' } as NoteFileContent })
        );

        await provider.addImageToNote(NOTE_ID, 'v1', imageBlob());

        expect(uploadMeta().isEncrypted).toBe(true);
        expect(uploadMeta().accessControlList.requiredSecurityGroup).toBe(SecurityGroupType.Owner);
        expect(keyHeaderArg()).toBe(fakeKeyHeader);
    });

    // #292: createThumbnails can't upscale past the source's natural size, so a
    // tiny image (e.g. 16x16) yields several additionalThumbnails with identical
    // pixelWidth x pixelHeight. The server's dimension lookup throws
    // "Sequence contains more than one matching element" on the duplicate. They
    // must be deduped by dimensions before patchFile is called.
    it('dedupes additionalThumbnails with the same pixelWidth x pixelHeight before upload', async () => {
        mockGetHeader.mockResolvedValue(
            header({ payloadKeys: ['jrnl_img0'], isEncrypted: true, content: { title: 'x' } as NoteFileContent })
        );
        mockCreateThumbnails.mockResolvedValue({
            additionalThumbnails: [
                { pixelWidth: 16, pixelHeight: 16, contentType: 'image/webp', payload: new Blob(), key: 'jrnl_img1' },
                { pixelWidth: 16, pixelHeight: 16, contentType: 'image/png', payload: new Blob(), key: 'jrnl_img1' },
                { pixelWidth: 32, pixelHeight: 32, contentType: 'image/png', payload: new Blob(), key: 'jrnl_img1' },
            ],
            tinyThumb: { pixelWidth: 1, pixelHeight: 1, contentType: 'image/png', content: '' },
        });

        await provider.addImageToNote(NOTE_ID, 'v1', imageBlob());

        const thumbs = thumbnailsArg();
        expect(thumbs).toHaveLength(2);
        expect(thumbs.map((t: { pixelWidth: number; pixelHeight: number }) => `${t.pixelWidth}x${t.pixelHeight}`))
            .toEqual(['16x16', '32x32']);
    });
    // Homebase refuses the whole upload when one thumbnail is over 1 MiB
    // ("ThumbnailDescriptor BytesWritten 1678832 too long, max 1048576")
    it('drops thumbnails over the server limit and keeps the smaller ones', async () => {
        mockGetHeader.mockResolvedValue(header({ payloadKeys: [] }));
        const bytes = (n: number) => new Blob([new Uint8Array(n)], { type: 'image/png' });
        mockCreateThumbnails.mockResolvedValue({
            additionalThumbnails: [
                { pixelWidth: 20, pixelHeight: 20, payload: bytes(500), key: 'jrnl_img0' },
                { pixelWidth: 1080, pixelHeight: 1080, payload: bytes(MAX_THUMBNAIL_BYTES), key: 'jrnl_img0' },
                { pixelWidth: 1600, pixelHeight: 1600, payload: bytes(1_678_832), key: 'jrnl_img0' },
            ],
            tinyThumb: { pixelWidth: 1, pixelHeight: 1, contentType: 'image/webp', content: '' },
        });

        await provider.addImageToNote(NOTE_ID, 'v1', imageBlob());

        expect(MAX_THUMBNAIL_BYTES).toBeLessThan(1024 * 1024);
        expect(thumbnailsArg().map((t: { pixelWidth: number }) => t.pixelWidth)).toEqual([20, 1080]);
        expect(payloadsArg()[0].previewThumbnail).toEqual({ pixelWidth: 1, pixelHeight: 1, contentType: 'image/webp', content: '' });
    });

    it('drops the image as its own thumbnail when it is over the server limit (no canvas)', async () => {
        mockGetHeader.mockResolvedValue(header({ payloadKeys: [] }));
        const file = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/png' });

        await provider.addImageToNote(NOTE_ID, 'v1', { file, naturalSize: { pixelWidth: 3000, pixelHeight: 3000 } });

        expect(thumbnailsArg()).toEqual([]);
        expect(payloadsArg()[0].payload).toBe(file);
    });

    // An image whose thumbnails can't be drawn still uploads, without thumbnails
    it('uploads the image with no thumbnails when createThumbnails throws', async () => {
        mockGetHeader.mockResolvedValue(header({ payloadKeys: [] }));
        mockCreateThumbnails.mockRejectedValue(new Error('The world has ended. A 1x1 thumb in quality 1 takes up more than MaxBytes bytes...'));
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const image = imageBlob();

        await provider.addImageToNote(NOTE_ID, 'v1', image);

        expect(thumbnailsArg()).toEqual([]);
        expect(payloadsArg()[0].payload).toBe(image.file);
        expect(payloadsArg()[0].previewThumbnail).toBeUndefined();
    });

    it('leaves out a preview over the server\'s 1 KiB limit and keeps the thumbnails', async () => {
        mockGetHeader.mockResolvedValue(header({ payloadKeys: [] }));
        const thumb = { pixelWidth: 320, pixelHeight: 320, payload: new Blob([new Uint8Array(100)]), key: 'jrnl_img0' };
        const base64 = (n: number) => btoa(String.fromCharCode(...new Uint8Array(n)));
        mockCreateThumbnails.mockResolvedValue({
            additionalThumbnails: [thumb],
            tinyThumb: { pixelWidth: 1, pixelHeight: 1, contentType: 'image/jpeg', content: base64(MAX_PREVIEW_BYTES + 1) },
        });

        await provider.addImageToNote(NOTE_ID, 'v1', imageBlob());

        expect(payloadsArg()[0].previewThumbnail).toBeUndefined();
        expect(thumbnailsArg()).toEqual([thumb]);

        mockPatch.mockClear();
        const fits = { pixelWidth: 1, pixelHeight: 1, contentType: 'image/png', content: base64(MAX_PREVIEW_BYTES) };
        mockCreateThumbnails.mockResolvedValue({ additionalThumbnails: [thumb], tinyThumb: fits });
        await provider.addImageToNote(NOTE_ID, 'v1', imageBlob());
        expect(payloadsArg()[0].previewThumbnail).toEqual(fits);
    });

    // A retry must not resend the thumbnails of a failed attempt: each upload draws them
    // again from the image bytes, with the current createThumbnails
    it('draws the thumbnails again from the image bytes on every attempt', async () => {
        mockGetHeader.mockResolvedValue(header({ payloadKeys: [] }));
        const image = imageBlob();

        await provider.addImageToNote(NOTE_ID, 'v1', image);
        await provider.addImageToNote(NOTE_ID, 'v1', image);

        expect(mockCreateThumbnails).toHaveBeenCalledTimes(2);
        for (const [file] of mockCreateThumbnails.mock.calls) expect(file).toBe(image.file);
    });

    // #469: a content save on the same note can land between the header fetch and
    // the patch. The image upload must refetch the header and retry once.
    it('refetches the header and retries once on VersionTagMismatch', async () => {
        const stale = header({ payloadKeys: ['jrnl_img0'] });
        const fresh = header({ payloadKeys: ['jrnl_img0', 'jrnl_img1'] });
        fresh.fileMetadata.versionTag = 'v-fresh';
        mockGetHeader.mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
        // patchFile args[7] is onVersionConflict; the SDK returns its result on a mismatch
        mockPatch
            .mockImplementationOnce((...args) => args[7]())
            .mockResolvedValueOnce({ newVersionTag: 'v3' });

        const result = await provider.addImageToNote(NOTE_ID, 'v1', imageBlob());

        expect(mockPatch).toHaveBeenCalledTimes(2);
        expect(mockPatch.mock.calls[1][2].versionTag).toBe('v-fresh');
        expect(mockPatch.mock.calls[1][3].versionTag).toBe('v-fresh');
        expect(result).toEqual({ versionTag: 'v3', payloadKey: 'jrnl_img2' });
    });

    it('keeps the minIndex floor on the VersionTagMismatch retry', async () => {
        mockGetHeader
            .mockResolvedValueOnce(header({ payloadKeys: ['jrnl_img0'] }))
            .mockResolvedValueOnce(header({ payloadKeys: ['jrnl_img0'] }));
        mockPatch
            .mockImplementationOnce((...args) => args[7]())
            .mockResolvedValueOnce({ newVersionTag: 'v3' });

        const result = await provider.addImageToNote(NOTE_ID, 'v1', imageBlob(), 5);

        expect(result).toEqual({ versionTag: 'v3', payloadKey: 'jrnl_img5' });
    });
});
