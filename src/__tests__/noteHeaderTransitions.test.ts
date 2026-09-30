import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeDotYouClient } from './fakes';
import { SecurityGroupType } from '@homebase-id/js-lib/core';

// Characterization tests for the five note header transitions (#161). Only the
// SDK calls they touch are mocked; enums and everything else stay real.
const { mockGetHeader, mockReUpload, mockPatchFile, mockUploadFile, mockDeleteFile } = vi.hoisted(() => ({
    mockGetHeader: vi.fn(),
    mockReUpload: vi.fn(),
    mockPatchFile: vi.fn(),
    mockUploadFile: vi.fn(),
    mockDeleteFile: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        getFileHeaderByUniqueId: mockGetHeader,
        reUploadFile: mockReUpload,
        patchFile: mockPatchFile,
        uploadFile: mockUploadFile,
        deleteFile: mockDeleteFile,
    };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import {
    JOURNAL_DRIVE,
    JOURNAL_FILE_TYPE,
    JOURNAL_DATA_TYPE,
    COLLABORATIVE_FOLDER_ID,
    MAIN_FOLDER_ID,
} from '@/lib/homebase/config';

const NOTE_ID = '33333333-3333-3333-3333-333333333333';
const USER_DATE = 1690000000000;
const KEY_HEADER = { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' };
const fakeClient = fakeDotYouClient();

const CONTENT = {
    title: 'Dated Note',
    tags: ['tag-a'],
    excludeFromAI: true,
    isPinned: true,
    isPublic: true,
};

type ContentShape = 'object' | 'string';
const SHAPES: ContentShape[] = ['object', 'string'];

function noteHeader(shape: ContentShape, opts: { isEncrypted?: boolean; acl?: object } = {}) {
    const isEncrypted = opts.isEncrypted ?? true;
    return {
        fileId: 'file-1',
        sharedSecretEncryptedKeyHeader: isEncrypted ? KEY_HEADER : undefined,
        fileMetadata: {
            versionTag: 'v1',
            isEncrypted,
            appData: {
                fileType: JOURNAL_FILE_TYPE,
                dataType: JOURNAL_DATA_TYPE,
                uniqueId: NOTE_ID,
                groupId: 'folder-7',
                userDate: USER_DATE,
                tags: ['tag-a'],
                content: shape === 'object' ? { ...CONTENT } : JSON.stringify(CONTENT),
            },
        },
        serverMetadata: {
            accessControlList: opts.acl ?? { requiredSecurityGroup: SecurityGroupType.Owner },
        },
    };
}

/** Serve the note header for NOTE_ID; the invitation lookup gets nothing. */
function serveNote(header: ReturnType<typeof noteHeader>) {
    mockGetHeader.mockImplementation(async (_c: unknown, _d: unknown, uniqueId: string) =>
        uniqueId === NOTE_ID ? header : null
    );
}

function appDataBase(groupId: string) {
    return {
        fileType: JOURNAL_FILE_TYPE,
        dataType: JOURNAL_DATA_TYPE,
        uniqueId: NOTE_ID,
        groupId,
        userDate: USER_DATE,
        tags: ['tag-a'],
    };
}

const reUploadInstructions = {
    storageOptions: { drive: JOURNAL_DRIVE, overwriteFileId: 'file-1' },
    transferIv: expect.any(Uint8Array),
};

const patchInstructions = {
    locale: 'local',
    file: { fileId: 'file-1', targetDrive: JOURNAL_DRIVE },
    versionTag: 'v1',
};

describe('note header transitions (#161)', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockReUpload.mockResolvedValue({ newVersionTag: 'v2' });
        mockPatchFile.mockResolvedValue({ newVersionTag: 'v3' });
        mockUploadFile.mockResolvedValue({});
        provider = new NotesDriveProvider(fakeClient);
    });

    describe.each(SHAPES)('with %s content', (shape) => {
        it('makeNotePublic re-uploads unencrypted with the minimal public projection', async () => {
            serveNote(noteHeader(shape));

            await expect(provider.makeNotePublic(NOTE_ID)).resolves.toEqual({ versionTag: 'v2', previousVersionTag: 'v1' });

            expect(mockPatchFile).not.toHaveBeenCalled();
            expect(mockReUpload).toHaveBeenCalledTimes(1);
            const [, instructions, metadata, encrypt] = mockReUpload.mock.calls[0];
            expect(instructions).toEqual(reUploadInstructions);
            expect(encrypt).toBe(false);
            expect(metadata).toEqual({
                versionTag: 'v1',
                allowDistribution: false,
                appData: {
                    ...appDataBase('folder-7'),
                    content: JSON.stringify({ title: 'Dated Note', tags: ['tag-a'], isPublic: true }),
                },
                isEncrypted: false,
                accessControlList: { requiredSecurityGroup: SecurityGroupType.Anonymous },
            });
        });

        it('makeNotePrivate re-uploads encrypted, owner-only, keeping every content field', async () => {
            serveNote(noteHeader(shape, {
                isEncrypted: false,
                acl: { requiredSecurityGroup: SecurityGroupType.Anonymous },
            }));

            await expect(provider.makeNotePrivate(NOTE_ID)).resolves.toEqual({ versionTag: 'v2', previousVersionTag: 'v1' });

            expect(mockPatchFile).not.toHaveBeenCalled();
            const [, instructions, metadata, encrypt] = mockReUpload.mock.calls[0];
            expect(instructions).toEqual(reUploadInstructions);
            expect(encrypt).toBe(true);
            expect(metadata).toEqual({
                versionTag: 'v1',
                allowDistribution: false,
                appData: { ...appDataBase('folder-7'), content: expect.any(String) },
                isEncrypted: true,
                accessControlList: { requiredSecurityGroup: SecurityGroupType.Owner },
            });
            expect(JSON.parse(metadata.appData.content)).toEqual({ ...CONTENT, isPublic: false });
        });

        it('setNoteArchivalStatus patches the status and keeps content, ACL and encryption', async () => {
            serveNote(noteHeader(shape));

            await expect(provider.setNoteArchivalStatus(NOTE_ID, 2)).resolves.toEqual({ versionTag: 'v3', previousVersionTag: 'v1' });

            expect(mockReUpload).not.toHaveBeenCalled();
            const [, keyHeader, instructions, metadata] = mockPatchFile.mock.calls[0];
            expect(keyHeader).toEqual(KEY_HEADER);
            expect(instructions).toEqual(patchInstructions);
            expect(metadata).toEqual({
                versionTag: 'v1',
                allowDistribution: false,
                appData: {
                    ...appDataBase('folder-7'),
                    content: JSON.stringify(CONTENT),
                    archivalStatus: 2,
                },
                isEncrypted: true,
                accessControlList: { requiredSecurityGroup: SecurityGroupType.Owner },
            });
        });

        // Regression #161: makeNoteCollaborative used to cast appData.content without
        // parsing it and hand-list 8 fields, dropping userDate/tags/isPublic and (for
        // string content) wiping the title to ''.
        it('makeNoteCollaborative keeps title, tags, userDate and writes isPublic: false', async () => {
            serveNote(noteHeader(shape));

            await expect(
                provider.makeNoteCollaborative(NOTE_ID, ['circle-1'], ['friend.id'], 'me.id')
            ).resolves.toEqual({ versionTag: 'v3', previousVersionTag: 'v1' });

            expect(mockReUpload).not.toHaveBeenCalled();
            const [, keyHeader, instructions, metadata] = mockPatchFile.mock.calls[0];
            expect(keyHeader).toEqual(KEY_HEADER);
            expect(instructions).toEqual(patchInstructions);
            expect(metadata).toEqual({
                versionTag: 'v1',
                allowDistribution: false,
                appData: { ...appDataBase(COLLABORATIVE_FOLDER_ID), content: expect.any(String) },
                isEncrypted: true,
                accessControlList: {
                    requiredSecurityGroup: SecurityGroupType.Connected,
                    circleIdList: ['circle-1'],
                },
            });
            expect(JSON.parse(metadata.appData.content)).toEqual({
                ...CONTENT,
                isPublic: false,
                isCollaborative: true,
                circleIds: ['circle-1'],
                recipients: ['friend.id'],
                lastEditedBy: 'me.id',
            });
            // The invitation carries the real title.
            expect(JSON.parse(mockUploadFile.mock.calls[0][2].appData.content).noteTitle).toBe('Dated Note');
        });

        // Regression #161: same cast as makeNoteCollaborative — userDate, tags and
        // isPublic were dropped, and string content lost its title.
        it('revokeNoteCollaboration keeps title, tags, userDate and writes isPublic: false', async () => {
            serveNote(noteHeader(shape, {
                acl: { requiredSecurityGroup: SecurityGroupType.Connected, circleIdList: ['circle-1'] },
            }));

            await expect(provider.revokeNoteCollaboration(NOTE_ID, 'me.id')).resolves.toEqual({ versionTag: 'v3', previousVersionTag: 'v1' });

            expect(mockReUpload).not.toHaveBeenCalled();
            const [, keyHeader, instructions, metadata] = mockPatchFile.mock.calls[0];
            expect(keyHeader).toEqual(KEY_HEADER);
            expect(instructions).toEqual(patchInstructions);
            expect(metadata).toEqual({
                versionTag: 'v1',
                allowDistribution: false,
                appData: { ...appDataBase(MAIN_FOLDER_ID), content: expect.any(String) },
                isEncrypted: true,
                accessControlList: { requiredSecurityGroup: SecurityGroupType.Owner },
            });
            expect(JSON.parse(metadata.appData.content)).toEqual({
                ...CONTENT,
                isPublic: false,
                isCollaborative: false,
                lastEditedBy: 'me.id',
            });
        });
    });

    // Regression #161: a header-only patch can't encrypt an existing plaintext payload,
    // so a public note made collaborative must be re-uploaded encrypted first. It used
    // to be only patched to isEncrypted: true, leaving the payload plaintext.
    it('makeNoteCollaborative on a public note re-uploads it encrypted before patching', async () => {
        const publicHeader = noteHeader('string', {
            isEncrypted: false,
            acl: { requiredSecurityGroup: SecurityGroupType.Anonymous },
        });
        const privateHeader = { ...noteHeader('string'), fileMetadata: { ...noteHeader('string').fileMetadata, versionTag: 'v2' } };
        let current: typeof publicHeader = publicHeader;
        mockGetHeader.mockImplementation(async (_c: unknown, _d: unknown, uniqueId: string) =>
            uniqueId === NOTE_ID ? current : null
        );
        mockReUpload.mockImplementation(async () => {
            current = privateHeader;
            return { newVersionTag: 'v2' };
        });

        await provider.makeNoteCollaborative(NOTE_ID, ['circle-1'], ['friend.id'], 'me.id');

        expect(mockReUpload).toHaveBeenCalledTimes(1);
        expect(mockReUpload.mock.calls[0][2].isEncrypted).toBe(true);
        expect(mockReUpload.mock.calls[0][3]).toBe(true);
        expect(mockPatchFile).toHaveBeenCalledTimes(1);
        expect(mockReUpload.mock.invocationCallOrder[0]).toBeLessThan(mockPatchFile.mock.invocationCallOrder[0]);
        // The patch runs against the re-fetched, re-keyed header.
        const [, keyHeader, instructions, metadata] = mockPatchFile.mock.calls[0];
        expect(keyHeader).toEqual(KEY_HEADER);
        expect(instructions.versionTag).toBe('v2');
        expect(metadata.versionTag).toBe('v2');
        expect(metadata.isEncrypted).toBe(true);
        expect(JSON.parse(metadata.appData.content).isPublic).toBe(false);
    });

    it.each([
        ['makeNotePublic', () => provider.makeNotePublic(NOTE_ID), mockReUpload],
        ['makeNotePrivate', () => provider.makeNotePrivate(NOTE_ID), mockReUpload],
        ['makeNoteCollaborative', () => provider.makeNoteCollaborative(NOTE_ID, ['circle-1'], ['friend.id'], 'me.id'), mockPatchFile],
        ['revokeNoteCollaboration', () => provider.revokeNoteCollaboration(NOTE_ID, 'me.id'), mockPatchFile],
    ] as const)('%s keeps a trashed note trashed', async (_name, run, writer) => {
        const header = noteHeader('object');
        (header.fileMetadata.appData as Record<string, unknown>).archivalStatus = 2;
        serveNote(header);

        await run();

        const metadata = writer.mock.calls[0][writer === mockReUpload ? 2 : 3];
        expect(metadata.appData.archivalStatus).toBe(2);
    });
});
