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
import type { DotYouClient, HomebaseFile, EncryptedKeyHeader } from '@homebase-id/js-lib/core';
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

const NOTE_ID = '11111111-1111-1111-1111-111111111111';
const fakeClient = { getHostIdentity: () => 'me.dotyou.cloud' } as unknown as DotYouClient;
const fakeKeyHeader = { encryptionVersion: 1 } as unknown as EncryptedKeyHeader;

// patchFile args: (client, keyHeader, instructions, uploadMetadata, payloads, thumbnails)
const keyHeaderArg = () => mockPatch.mock.calls[0][1];
const uploadMeta = () => mockPatch.mock.calls[0][3];
const payloadsArg = () => mockPatch.mock.calls[0][4];

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
            tinyThumb: { pixelWidth: 1, pixelHeight: 1, contentType: 'image/png' },
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
});
