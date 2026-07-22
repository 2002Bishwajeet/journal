import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { SecurityGroupType } from '@homebase-id/js-lib/core';

// Mock only the two SDK calls makeNotePublic/makeNotePrivate use; keep the real
// enums (SecurityGroupType) and everything else intact.
const { mockGetHeader, mockReUpload } = vi.hoisted(() => ({
    mockGetHeader: vi.fn(),
    mockReUpload: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return { ...actual, getFileHeaderByUniqueId: mockGetHeader, reUploadFile: mockReUpload };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';

const NOTE_ID = '11111111-1111-1111-1111-111111111111';
const fakeClient = { getHostIdentity: () => 'me.dotyou.cloud' } as unknown as DotYouClient;

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
