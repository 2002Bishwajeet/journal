import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeDotYouClient } from './fakes';
import { SecurityGroupType } from '@homebase-id/js-lib/core';

// Mock only the two SDK calls makeNotePublic/makeNotePrivate use; keep the real
// enums (SecurityGroupType) and everything else intact.
const { mockGetHeader, mockGetHeaderByFileId, mockReUpload } = vi.hoisted(() => ({
    mockGetHeader: vi.fn(),
    mockGetHeaderByFileId: vi.fn(),
    mockReUpload: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        getFileHeaderByUniqueId: mockGetHeader,
        getFileHeader: mockGetHeaderByFileId,
        reUploadFile: mockReUpload,
    };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';

const NOTE_ID = '11111111-1111-1111-1111-111111111111';
const fakeClient = fakeDotYouClient();

// Header as returned by a decrypted owner fetch: appData.content is the parsed object.
function ownerHeader() {
    return {
        fileId: 'file-1',
        fileMetadata: {
            versionTag: 'v1',
            transitUpdated: 1700000000000,
            appData: {
                uniqueId: NOTE_ID,
                groupId: 'folder-7',
                userDate: 1690000000000,
                tags: ['tag-a'],
                content: { title: 'My Secret Note', tags: ['tag-a'], excludeFromAI: false },
            },
        },
    };
}

describe('NotesDriveProvider.makeNotePublic', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockReUpload.mockResolvedValue({ newVersionTag: 'v2' });
        provider = new NotesDriveProvider(fakeClient);
    });

    it('preserves the note title, created date, folder and tags when publishing', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.makeNotePublic(NOTE_ID);

        const metadata = mockReUpload.mock.calls[0][2];
        const content = JSON.parse(metadata.appData.content);
        expect(content.title).toBe('My Secret Note');
        expect(content.isPublic).toBe(true);
        expect(metadata.appData.userDate).toBe(1690000000000);
        expect(metadata.appData.groupId).toBe('folder-7');
        expect(metadata.appData.tags).toEqual(['tag-a']);
    });

    it('reads the header decrypted so the re-stored title is plaintext', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.makeNotePublic(NOTE_ID);

        expect(mockGetHeader).toHaveBeenCalledWith(
            fakeClient,
            expect.anything(),
            NOTE_ID,
            expect.objectContaining({ decrypt: true })
        );
    });

    it('re-uploads with an anonymous, unencrypted ACL', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.makeNotePublic(NOTE_ID);

        const metadata = mockReUpload.mock.calls[0][2];
        expect(metadata.isEncrypted).toBe(false);
        expect(metadata.accessControlList.requiredSecurityGroup).toBe(SecurityGroupType.Anonymous);
        expect(mockReUpload.mock.calls[0][3]).toBe(false); // encrypt flag
    });

    // allowDistribution governs peer/feed distribution, not public readability —
    // the Anonymous ACL is what makes the note world-readable.
    it('does not flag the note for peer/feed distribution', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.makeNotePublic(NOTE_ID);

        expect(mockReUpload.mock.calls[0][2].allowDistribution).toBe(false);
    });

    // #293: right after a note is created the server's uniqueId lookup can 404 for a
    // few seconds, while the header is already readable by its fileId.
    it('succeeds right after create by reading the header by its known fileId', async () => {
        mockGetHeader.mockResolvedValue(null); // uniqueId lookup still 404s
        mockGetHeaderByFileId.mockResolvedValue(ownerHeader());

        await expect(provider.makeNotePublic(NOTE_ID, 'file-1')).resolves.toEqual({ versionTag: 'v2' });

        expect(mockGetHeaderByFileId).toHaveBeenCalledWith(
            fakeClient,
            expect.anything(),
            'file-1',
            expect.objectContaining({ decrypt: true })
        );
        expect(mockReUpload.mock.calls[0][1].storageOptions.overwriteFileId).toBe('file-1');
    });

    it('falls back to the uniqueId lookup when no fileId is known', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.makeNotePublic(NOTE_ID);

        expect(mockGetHeaderByFileId).not.toHaveBeenCalled();
        expect(mockGetHeader).toHaveBeenCalled();
    });

    it('falls back to the uniqueId lookup when the fileId is not found', async () => {
        mockGetHeaderByFileId.mockResolvedValue(null);
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.makeNotePublic(NOTE_ID, 'stale-file');

        expect(mockReUpload.mock.calls[0][1].storageOptions.overwriteFileId).toBe('file-1');
    });
});

describe('NotesDriveProvider.makeNotePrivate', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockReUpload.mockResolvedValue({ newVersionTag: 'v3' });
        provider = new NotesDriveProvider(fakeClient);
    });

    it('preserves the title and created date and re-encrypts as owner-only', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.makeNotePrivate(NOTE_ID);

        const metadata = mockReUpload.mock.calls[0][2];
        const content = JSON.parse(metadata.appData.content);
        expect(content.title).toBe('My Secret Note');
        expect(content.isPublic).toBe(false);
        expect(metadata.appData.userDate).toBe(1690000000000);
        expect(metadata.isEncrypted).toBe(true);
        expect(metadata.accessControlList.requiredSecurityGroup).toBe(SecurityGroupType.Owner);
        expect(mockReUpload.mock.calls[0][3]).toBe(true); // encrypt flag
    });
});
