import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { SecurityGroupType } from '@homebase-id/js-lib/core';
import type { DocumentMetadata } from '@/types';

const { mockGetHeader, mockPatchFile, mockUploadFile } = vi.hoisted(() => ({
    mockGetHeader: vi.fn(),
    mockPatchFile: vi.fn(),
    mockUploadFile: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        getFileHeaderByUniqueId: mockGetHeader,
        patchFile: mockPatchFile,
        uploadFile: mockUploadFile,
    };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';

const NOTE_ID = '22222222-2222-2222-2222-222222222222';
const fakeClient = { getHostIdentity: () => 'me.dotyou.cloud' } as unknown as DotYouClient;

function ownerHeader() {
    return {
        fileId: 'file-1',
        sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
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

const baseMeta: DocumentMetadata = {
    title: 'My Note',
    folderId: 'folder-7',
    tags: [],
    timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
    excludeFromAI: false,
};

describe('NotesDriveProvider.setNoteArchivalStatus', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockPatchFile.mockResolvedValue({ newVersionTag: 'v2' });
        provider = new NotesDriveProvider(fakeClient);
    });

    it('trashes a note (archivalStatus 2) via a header-only patch (no payload re-upload)', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.setNoteArchivalStatus(NOTE_ID, 2);

        expect(mockPatchFile).toHaveBeenCalledTimes(1);
        const metadata = mockPatchFile.mock.calls[0][3];
        const payloads = mockPatchFile.mock.calls[0][4];
        expect(metadata.appData.archivalStatus).toBe(2);
        expect(JSON.parse(metadata.appData.content).title).toBe('My Note');
        expect(metadata.appData.userDate).toBe(1690000000000);
        expect(metadata.isEncrypted).toBe(true);
        expect(metadata.accessControlList.requiredSecurityGroup).toBe(SecurityGroupType.Owner);
        // header-only: nothing re-uploaded
        expect(payloads ?? []).toHaveLength(0);
    });

    it('restores a note (archivalStatus 0)', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.setNoteArchivalStatus(NOTE_ID, 0);

        expect(mockPatchFile.mock.calls[0][3].appData.archivalStatus).toBe(0);
    });

    // allowDistribution is peer/feed distribution, not readability: trashing a
    // public (Anonymous) note must not flag it for distribution.
    it('never flags the file for peer/feed distribution', async () => {
        mockGetHeader.mockResolvedValue({
            ...ownerHeader(),
            serverMetadata: { accessControlList: { requiredSecurityGroup: SecurityGroupType.Anonymous } },
        });

        await provider.setNoteArchivalStatus(NOTE_ID, 2);

        expect(mockPatchFile.mock.calls[0][3].allowDistribution).toBe(false);
    });

    it('reads the header decrypted so the patched content stays valid', async () => {
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

describe('archivalStatus survives normal create/update (no silent un-trash)', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockUploadFile.mockResolvedValue({ file: { fileId: 'f' }, newVersionTag: 'v' });
        mockPatchFile.mockResolvedValue({ newVersionTag: 'v2' });
        provider = new NotesDriveProvider(fakeClient);
    });

    it('createNote carries archivalStatus into appData', async () => {
        await provider.createNote(NOTE_ID, { ...baseMeta, archivalStatus: 2 });

        const metadata = mockUploadFile.mock.calls[0][2];
        expect(metadata.appData.archivalStatus).toBe(2);
    });

    it('updateNote carries archivalStatus into appData (editing a trashed note keeps it trashed)', async () => {
        await provider.updateNote(NOTE_ID, 'file-1', 'v1', { ...baseMeta, archivalStatus: 2 });

        const metadata = mockPatchFile.mock.calls[0][3];
        expect(metadata.appData.archivalStatus).toBe(2);
    });
});
