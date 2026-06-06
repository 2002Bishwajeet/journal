import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { SecurityGroupType } from '@homebase-id/js-lib/core';

const { mockGetHeader, mockReUpload } = vi.hoisted(() => ({
    mockGetHeader: vi.fn(),
    mockReUpload: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return { ...actual, getFileHeaderByUniqueId: mockGetHeader, reUploadFile: mockReUpload };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';

const NOTE_ID = '22222222-2222-2222-2222-222222222222';
const fakeClient = { getHostIdentity: () => 'me.dotyou.cloud' } as unknown as DotYouClient;

function ownerHeader() {
    return {
        fileId: 'file-1',
        fileMetadata: {
            versionTag: 'v1',
            isEncrypted: true,
            appData: {
                uniqueId: NOTE_ID,
                groupId: 'folder-7',
                userDate: 1690000000000,
                tags: ['t'],
                content: { title: 'My Note', tags: ['t'], excludeFromAI: false },
            },
        },
        serverMetadata: { accessControlList: { requiredSecurityGroup: SecurityGroupType.Owner } },
    };
}

describe('NotesDriveProvider.setNoteArchivalStatus', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockReUpload.mockResolvedValue({ newVersionTag: 'v2' });
        provider = new NotesDriveProvider(fakeClient);
    });

    it('marks a note as trashed (archivalStatus 2) while preserving content and encryption', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.setNoteArchivalStatus(NOTE_ID, 2);

        const metadata = mockReUpload.mock.calls[0][2];
        expect(metadata.appData.archivalStatus).toBe(2);
        expect(JSON.parse(metadata.appData.content).title).toBe('My Note');
        expect(metadata.appData.userDate).toBe(1690000000000);
        expect(metadata.isEncrypted).toBe(true);
        expect(metadata.accessControlList.requiredSecurityGroup).toBe(SecurityGroupType.Owner);
    });

    it('restores a note (archivalStatus 0)', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.setNoteArchivalStatus(NOTE_ID, 0);

        const metadata = mockReUpload.mock.calls[0][2];
        expect(metadata.appData.archivalStatus).toBe(0);
    });

    it('reads the header decrypted so re-stored content stays valid', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.setNoteArchivalStatus(NOTE_ID, 2);

        expect(mockGetHeader).toHaveBeenCalledWith(
            fakeClient,
            expect.anything(),
            NOTE_ID,
            expect.objectContaining({ decrypt: true })
        );
    });
});
