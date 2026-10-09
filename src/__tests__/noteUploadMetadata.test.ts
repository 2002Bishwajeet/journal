/**
 * Characterization (#236): the full UploadFileMetadata that createNote, updateNote
 * and addImageToNote send for a public, a collaborative-with-circles and a private
 * note. Pins the ACL tri-state and app-data construction so consolidating them into
 * one builder can't change what is uploaded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecurityGroupType } from '@homebase-id/js-lib/core';
import type { HomebaseFile } from '@homebase-id/js-lib/core';
import { toGuidId } from '@homebase-id/js-lib/helpers';
import { fakeDotYouClient } from './fakes';
import type { DocumentMetadata, NoteFileContent } from '@/types';

const { mockPatch, mockUpload, mockGetHeader, mockCreateThumbnails } = vi.hoisted(() => ({
    mockPatch: vi.fn(),
    mockUpload: vi.fn(),
    mockGetHeader: vi.fn(),
    mockCreateThumbnails: vi.fn(),
}));

vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        patchFile: mockPatch,
        uploadFile: mockUpload,
        getFileHeaderByUniqueId: mockGetHeader,
    };
});
vi.mock('@homebase-id/js-lib/media', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/media')>();
    return { ...actual, createThumbnails: mockCreateThumbnails };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';

const NOTE_ID = '11111111-1111-1111-1111-111111111111';
const CREATED = '2026-01-02T03:04:05.000Z';
const CREATED_MS = new Date(CREATED).getTime();
const fakeClient = fakeDotYouClient();

type Visibility = 'public' | 'collaborative' | 'private';
const VISIBILITIES: Visibility[] = ['public', 'collaborative', 'private'];

const ACL = {
    public: { requiredSecurityGroup: SecurityGroupType.Anonymous },
    collaborative: { requiredSecurityGroup: SecurityGroupType.Connected, circleIdList: ['circle-1', 'circle-2'] },
    private: { requiredSecurityGroup: SecurityGroupType.Owner },
};

function meta(visibility: Visibility): DocumentMetadata {
    return {
        title: 'Note',
        folderId: 'folder-1',
        tags: ['alpha', 'beta'],
        timestamps: { created: CREATED, modified: CREATED },
        excludeFromAI: false,
        isPinned: true,
        isPublic: visibility === 'public',
        shareDescription: 'Hello',
        ...(visibility === 'collaborative'
            ? {
                isCollaborative: true,
                circleIds: ['circle-1', 'circle-2'],
                recipients: ['friend.dotyou.cloud'],
                lastEditedBy: 'me.dotyou.cloud',
            }
            : {}),
    };
}

const expectedTags = ['alpha', 'beta'].map((t) => toGuidId(t));

// uploadFile args: (client, instructions, uploadMetadata, payloads, thumbnails, encrypt, ...)
// patchFile args:  (client, keyHeader, instructions, uploadMetadata, payloads, thumbnails, ...)

describe('createNote — full upload metadata', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockUpload.mockResolvedValue({ file: { fileId: 'file-1' }, newVersionTag: 'v1' });
        provider = new NotesDriveProvider(fakeClient);
    });

    it.each(VISIBILITIES)('%s note', async (visibility) => {
        const m = meta(visibility);
        await provider.createNote(NOTE_ID, m);

        expect(mockUpload.mock.calls[0][2]).toEqual({
            allowDistribution: false,
            appData: {
                uniqueId: NOTE_ID,
                groupId: 'folder-1',
                fileType: 605,
                dataType: 706,
                userDate: CREATED_MS,
                tags: expectedTags,
                content: JSON.stringify({
                    title: 'Note',
                    tags: ['alpha', 'beta'],
                    excludeFromAI: false,
                    isPinned: true,
                    isPublic: visibility === 'public',
                    shareDescription: 'Hello',
                }),
                archivalStatus: 0,
            },
            isEncrypted: visibility !== 'public',
            accessControlList: ACL[visibility],
        });
    });
});

describe('updateNote — full upload metadata', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockPatch.mockResolvedValue({ newVersionTag: 'v2' });
        provider = new NotesDriveProvider(fakeClient);
    });

    it.each(VISIBILITIES)('%s note', async (visibility) => {
        const m = { ...meta(visibility), archivalStatus: 2 };
        await provider.updateNote(NOTE_ID, 'file-1', 'v1', m);

        const content = visibility === 'public'
            ? JSON.stringify({
                title: 'Note',
                tags: ['alpha', 'beta'],
                isPublic: true,
                shareDescription: 'Hello',
                card: { description: 'Hello' },
            })
            : JSON.stringify({
                title: 'Note',
                tags: ['alpha', 'beta'],
                excludeFromAI: false,
                isPinned: true,
                isPublic: false,
                shareDescription: 'Hello',
                isCollaborative: m.isCollaborative,
                circleIds: m.circleIds,
                recipients: m.recipients,
                lastEditedBy: m.lastEditedBy,
            });

        expect(mockPatch.mock.calls[0][3]).toEqual({
            versionTag: 'v1',
            allowDistribution: false,
            appData: {
                uniqueId: NOTE_ID,
                groupId: 'folder-1',
                fileType: 605,
                dataType: 706,
                userDate: CREATED_MS,
                tags: expectedTags,
                content,
                archivalStatus: 2,
            },
            isEncrypted: visibility !== 'public',
            accessControlList: ACL[visibility],
        });
    });
});

describe('addImageToNote — full upload metadata', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockPatch.mockResolvedValue({ newVersionTag: 'v2' });
        mockCreateThumbnails.mockResolvedValue({ additionalThumbnails: [], tinyThumb: undefined });
        provider = new NotesDriveProvider(fakeClient);
    });

    const existingContent = (visibility: Visibility): NoteFileContent => ({
        title: 'Note',
        tags: ['alpha'],
        excludeFromAI: false,
        isPublic: visibility === 'public',
        ...(visibility === 'collaborative'
            ? { isCollaborative: true, circleIds: ['circle-1', 'circle-2'] }
            : {}),
    });

    it.each(VISIBILITIES)('%s note', async (visibility) => {
        const appData = {
            uniqueId: NOTE_ID,
            groupId: 'group-1',
            fileType: 605,
            dataType: 706,
            userDate: 123,
            tags: ['tag-guid'],
            archivalStatus: 0,
            content: existingContent(visibility),
        };
        mockGetHeader.mockResolvedValue({
            fileId: 'file-1',
            sharedSecretEncryptedKeyHeader: { encryptionVersion: 1 },
            fileMetadata: {
                versionTag: 'v-existing',
                isEncrypted: visibility !== 'public',
                payloads: [],
                appData,
            },
        } as unknown as HomebaseFile<NoteFileContent>);

        await provider.addImageToNote(NOTE_ID, 'v1', {
            file: new Blob([new Uint8Array([1])], { type: 'image/png' }),
            filename: 'x.png',
        });

        expect(mockPatch.mock.calls[0][3]).toEqual({
            versionTag: 'v-existing',
            allowDistribution: false,
            appData: { ...appData, content: JSON.stringify(existingContent(visibility)) },
            isEncrypted: visibility !== 'public',
            accessControlList: ACL[visibility],
        });
    });

    it('with a natural size (no canvas, as in the MCP server) the image is its own one thumbnail', async () => {
        mockGetHeader.mockResolvedValue({
            fileId: 'file-1',
            sharedSecretEncryptedKeyHeader: { encryptionVersion: 1 },
            fileMetadata: { versionTag: 'v-existing', isEncrypted: true, payloads: [], appData: { content: existingContent('private') } },
        } as unknown as HomebaseFile<NoteFileContent>);
        const file = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });

        const { payloadKey } = await provider.addImageToNote(NOTE_ID, 'v1', { file, naturalSize: { pixelWidth: 2400, pixelHeight: 1260 } }, 3);

        expect(payloadKey).toBe('jrnl_img3');
        expect(mockCreateThumbnails).not.toHaveBeenCalled();
        expect(mockPatch.mock.calls[0][4]).toMatchObject([{ key: 'jrnl_img3', payload: file }]);
        expect(mockPatch.mock.calls[0][5]).toEqual([{ key: 'jrnl_img3', pixelWidth: 2400, pixelHeight: 1260, payload: file }]);
    });
});
