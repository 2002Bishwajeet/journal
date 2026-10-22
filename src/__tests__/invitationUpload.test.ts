/**
 * Characterization (#679): the full UploadFileMetadata and instruction set that
 * createOrUpdateInvitation sends on the create and patch paths, and the deleteFile
 * call of deleteInvitation. Pins the invite upload so the shared-ACL and metadata
 * consolidation can't change what is uploaded.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    SecurityGroupType,
    ScheduleOptions,
    PriorityOptions,
    SendContents,
} from '@homebase-id/js-lib/core';
import { toGuidId } from '@homebase-id/js-lib/helpers';
import { fakeDotYouClient } from './fakes';
import {
    JOURNAL_DRIVE,
    COLLABORATION_INVITE_FILE_TYPE,
    COLLABORATION_INVITE_DATA_TYPE,
    COLLABORATIVE_FOLDER_ID,
} from '@/lib/homebase/config';

const { mockPatch, mockUpload, mockDelete, mockGetHeader } = vi.hoisted(() => ({
    mockPatch: vi.fn(),
    mockUpload: vi.fn(),
    mockDelete: vi.fn(),
    mockGetHeader: vi.fn(),
}));

vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        patchFile: mockPatch,
        uploadFile: mockUpload,
        deleteFile: mockDelete,
        getFileHeaderByUniqueId: mockGetHeader,
    };
});

import { InvitationDriveProvider } from '@/lib/homebase/InvitationDriveProvider';

const NOTE_ID = '11111111-1111-1111-1111-111111111111';
const INVITE_ID = toGuidId(`collab-invite-${NOTE_ID}`);
const NOW = '2026-01-02T03:04:05.000Z';
const CIRCLES = ['circle-1', 'circle-2'];
const RECIPIENTS = ['friend.dotyou.cloud'];
const AUTHOR = 'me.dotyou.cloud';
const fakeClient = fakeDotYouClient();
const KEY_HEADER = { encryptionVersion: 1 };

const expectedMetadata = {
    allowDistribution: true,
    appData: {
        fileType: COLLABORATION_INVITE_FILE_TYPE,
        dataType: COLLABORATION_INVITE_DATA_TYPE,
        uniqueId: INVITE_ID,
        groupId: COLLABORATIVE_FOLDER_ID,
        content: JSON.stringify({
            authorOdinId: AUTHOR,
            noteUniqueId: NOTE_ID,
            noteTitle: 'Title',
            notePreview: 'p'.repeat(150),
            sharedAt: NOW,
        }),
    },
    isEncrypted: true,
    accessControlList: {
        requiredSecurityGroup: SecurityGroupType.Connected,
        circleIdList: CIRCLES,
    },
};

function existingHeader(fileType: number) {
    return {
        fileId: 'invite-file-1',
        sharedSecretEncryptedKeyHeader: KEY_HEADER,
        fileMetadata: { versionTag: 'v-existing', appData: { fileType } },
    };
}

const share = (provider: InvitationDriveProvider) =>
    provider.createOrUpdateInvitation(NOTE_ID, 'Title', 'p'.repeat(200), CIRCLES, RECIPIENTS, AUTHOR);

describe('createOrUpdateInvitation', () => {
    let provider: InvitationDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW));
        provider = new InvitationDriveProvider(fakeClient);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('looks up the invite by its unique id without decrypting', async () => {
        mockGetHeader.mockResolvedValue(null);
        await share(provider);
        expect(mockGetHeader).toHaveBeenCalledWith(fakeClient, JOURNAL_DRIVE, INVITE_ID, { decrypt: false });
    });

    it('create path: uploads the full metadata with SendLater/High/All transit', async () => {
        mockGetHeader.mockResolvedValue(null);
        await share(provider);

        expect(mockPatch).not.toHaveBeenCalled();
        expect(mockUpload).toHaveBeenCalledTimes(1);
        const [client, instructions, metadata, payloads, thumbnails, encrypt] = mockUpload.mock.calls[0];
        expect(client).toBe(fakeClient);
        expect(instructions).toEqual({
            transferIv: expect.any(Uint8Array),
            storageOptions: { drive: JOURNAL_DRIVE },
            transitOptions: {
                recipients: RECIPIENTS,
                schedule: ScheduleOptions.SendLater,
                priority: PriorityOptions.High,
                sendContents: SendContents.All,
            },
        });
        expect(metadata).toEqual(expectedMetadata);
        expect(payloads).toEqual([]);
        expect(thumbnails).toEqual([]);
        expect(encrypt).toBe(true);
        expect(mockUpload.mock.calls[0]).toHaveLength(6);
    });

    it('patch path: patches with versionTag first, the update instructions and the key header', async () => {
        mockGetHeader.mockResolvedValue(existingHeader(COLLABORATION_INVITE_FILE_TYPE));
        await share(provider);

        expect(mockUpload).not.toHaveBeenCalled();
        expect(mockPatch).toHaveBeenCalledTimes(1);
        const [client, keyHeader, instructions, metadata] = mockPatch.mock.calls[0];
        expect(mockPatch.mock.calls[0]).toHaveLength(4);
        expect(client).toBe(fakeClient);
        expect(keyHeader).toBe(KEY_HEADER);
        expect(instructions).toEqual({
            locale: 'local',
            file: { fileId: 'invite-file-1', targetDrive: JOURNAL_DRIVE },
            versionTag: 'v-existing',
            recipients: RECIPIENTS,
        });
        expect(metadata).toEqual({ versionTag: 'v-existing', ...expectedMetadata });
        expect(Object.keys(metadata)[0]).toBe('versionTag');
    });

    it('a header of another file type counts as no invite (create path)', async () => {
        mockGetHeader.mockResolvedValue(existingHeader(605));
        await share(provider);

        expect(mockPatch).not.toHaveBeenCalled();
        expect(mockUpload.mock.calls[0][2]).toEqual(expectedMetadata);
    });
});

describe('deleteInvitation', () => {
    let provider: InvitationDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        provider = new InvitationDriveProvider(fakeClient);
    });

    it('deletes the existing invite file', async () => {
        mockGetHeader.mockResolvedValue(existingHeader(COLLABORATION_INVITE_FILE_TYPE));
        await provider.deleteInvitation(NOTE_ID);

        expect(mockGetHeader).toHaveBeenCalledWith(fakeClient, JOURNAL_DRIVE, INVITE_ID, { decrypt: false });
        expect(mockDelete).toHaveBeenCalledWith(fakeClient, JOURNAL_DRIVE, 'invite-file-1');
    });

    it('does nothing when there is no invite, or the header is another file type', async () => {
        mockGetHeader.mockResolvedValueOnce(null);
        await provider.deleteInvitation(NOTE_ID);
        mockGetHeader.mockResolvedValueOnce(existingHeader(605));
        await provider.deleteInvitation(NOTE_ID);

        expect(mockDelete).not.toHaveBeenCalled();
    });
});
