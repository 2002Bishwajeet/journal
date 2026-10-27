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
        // By fileId: nothing, so the provider falls back to the uniqueId lookup
        getFileHeader: async () => null,
        patchFile: mockPatchFile,
        // A note re-upload (make public/private, #451) overwrites the note's file; route it
        // to mockReUpload in reUploadFile's (client, instructions, metadata, encrypt) shape.
        // Invitation uploads create a new file and stay on mockUploadFile.
        uploadFile: (...args: unknown[]) =>
            (args[1] as { storageOptions?: { overwriteFileId?: string } }).storageOptions?.overwriteFileId
                ? mockReUpload(args[0], args[1], args[2], args[5], args[6])
                : mockUploadFile(...args),
        deleteFile: mockDeleteFile,
    };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import {
    JOURNAL_DRIVE,
    JOURNAL_FILE_TYPE,
    JOURNAL_DATA_TYPE,
} from '@/lib/homebase/config';

const NOTE_ID = '33333333-3333-3333-3333-333333333333';
const USER_DATE = 1690000000000;
const KEY_HEADER = { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' };
const fakeClient = fakeDotYouClient();
const CIRCLE_SHARE = { circleIds: ['circle-1'], odinIds: [], recipients: ['friend.id'], folderId: 'folder-7' };

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
                provider.makeNoteCollaborative(NOTE_ID, CIRCLE_SHARE, 'me.id')
            ).resolves.toEqual({ versionTag: 'v3', previousVersionTag: 'v1' });

            expect(mockReUpload).not.toHaveBeenCalled();
            const [, keyHeader, instructions, metadata] = mockPatchFile.mock.calls[0];
            expect(keyHeader).toEqual(KEY_HEADER);
            expect(instructions).toEqual(patchInstructions);
            expect(metadata).toEqual({
                versionTag: 'v1',
                allowDistribution: false,
                appData: { ...appDataBase('folder-7'), content: expect.any(String) },
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
            // No invite file (615) is uploaded any more (#747).
            expect(mockUploadFile).not.toHaveBeenCalled();
        });

        // Regression #161: same cast as makeNoteCollaborative — userDate, tags and
        // isPublic were dropped, and string content lost its title.
        it('revokeNoteCollaboration keeps title, tags, userDate and writes isPublic: false', async () => {
            serveNote(noteHeader(shape, {
                acl: { requiredSecurityGroup: SecurityGroupType.Connected, circleIdList: ['circle-1'] },
            }));

            await expect(provider.revokeNoteCollaboration(NOTE_ID, 'me.id', undefined, 'folder-7')).resolves.toEqual({ versionTag: 'v3', previousVersionTag: 'v1' });

            expect(mockReUpload).not.toHaveBeenCalled();
            const [, keyHeader, instructions, metadata] = mockPatchFile.mock.calls[0];
            expect(keyHeader).toEqual(KEY_HEADER);
            expect(instructions).toEqual(patchInstructions);
            expect(metadata).toEqual({
                versionTag: 'v1',
                allowDistribution: false,
                appData: { ...appDataBase('folder-7'), content: expect.any(String) },
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

    // #897: a note shared with a person names them in the ACL.
    it('makeNoteCollaborative with a person only uploads an odinIdList ACL and no circleIds', async () => {
        serveNote(noteHeader('object'));

        await provider.makeNoteCollaborative(NOTE_ID, { circleIds: [], odinIds: ['sam.id'], recipients: [], folderId: 'folder-7' }, 'me.id');

        const metadata = mockPatchFile.mock.calls[0][3];
        expect(metadata.accessControlList).toStrictEqual({ requiredSecurityGroup: SecurityGroupType.Connected, odinIdList: ['sam.id'] });
        const content = JSON.parse(metadata.appData.content);
        expect(content).toMatchObject({ isCollaborative: true, odinIds: ['sam.id'], recipients: [] });
        expect(content).not.toHaveProperty('circleIds');
    });

    it('makeNoteCollaborative with circles only stores no odinIds and sends no odinIdList', async () => {
        serveNote(noteHeader('object'));

        await provider.makeNoteCollaborative(NOTE_ID, CIRCLE_SHARE, 'me.id');

        expect(mockPatchFile.mock.calls[0][3].accessControlList).not.toHaveProperty('odinIdList');
        expect(JSON.parse(mockPatchFile.mock.calls[0][3].appData.content)).not.toHaveProperty('odinIds');
    });

    it('revokeNoteCollaboration drops the named viewers', async () => {
        const header = noteHeader('object');
        serveNote({
            ...header,
            fileMetadata: {
                ...header.fileMetadata,
                appData: { ...header.fileMetadata.appData, content: { ...CONTENT, isCollaborative: true, odinIds: ['sam.id'] } },
            },
        } as ReturnType<typeof noteHeader>);

        await provider.revokeNoteCollaboration(NOTE_ID, 'me.id', undefined, 'folder-7');

        expect(JSON.parse(mockPatchFile.mock.calls[0][3].appData.content)).not.toHaveProperty('odinIds');
    });

    // #897: a peer update strips odinIdList; the owner writes back the ACL the content names
    it('restoreNoteAcl patches the ACL the content names and keeps the content', async () => {
        const header = noteHeader('object', {
            acl: { requiredSecurityGroup: SecurityGroupType.Connected, circleIdList: ['circle-1'], odinIdList: [] },
        });
        const content = { ...CONTENT, isPublic: false, isCollaborative: true, circleIds: ['circle-1'], odinIds: ['sam.id'] };
        serveNote({
            ...header,
            fileMetadata: { ...header.fileMetadata, appData: { ...header.fileMetadata.appData, content } },
        } as ReturnType<typeof noteHeader>);

        await provider.restoreNoteAcl(NOTE_ID, 'file-1', content);

        const metadata = mockPatchFile.mock.calls[0][3];
        expect(metadata.accessControlList).toStrictEqual({
            requiredSecurityGroup: SecurityGroupType.Connected,
            circleIdList: ['circle-1'],
            odinIdList: ['sam.id'],
        });
        expect(JSON.parse(metadata.appData.content)).toEqual(content);
        expect(mockReUpload).not.toHaveBeenCalled();
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

        await provider.makeNoteCollaborative(NOTE_ID, CIRCLE_SHARE, 'me.id');

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

    // #689: a peer's edit landing between the header fetch and the patch made the
    // revoke's patch conflict. It is rebuilt once from the fresh header.
    describe('revokeNoteCollaboration on a version conflict', () => {
        const sharedAcl = { requiredSecurityGroup: SecurityGroupType.Connected, circleIdList: ['circle-1'] };
        const peerEdited = () => {
            const header = noteHeader('object', { acl: sharedAcl });
            header.fileMetadata.versionTag = 'v2';
            (header.fileMetadata as Record<string, unknown>).updated = 2000;
            header.fileMetadata.appData.content = { ...CONTENT, title: 'Peer title' };
            return header;
        };
        // The SDK hands a versionTagMismatch to the onVersionConflict argument, and throws without one.
        const conflictOnce = (onConflict: () => void) => {
            mockPatchFile.mockImplementationOnce(async (...args: unknown[]) => {
                onConflict();
                const handler = args[7] as (() => Promise<unknown>) | undefined;
                if (!handler) throw new Error('versionTagMismatch');
                return handler();
            });
        };

        it('retries the patch against the fresh header and still revokes', async () => {
            let current = noteHeader('object', { acl: sharedAcl });
            mockGetHeader.mockImplementation(async (_c: unknown, _d: unknown, uniqueId: string) =>
                uniqueId === NOTE_ID ? current : null
            );
            conflictOnce(() => { current = peerEdited(); });

            await expect(provider.revokeNoteCollaboration(NOTE_ID, 'me.id', undefined, 'folder-7')).resolves.toEqual({
                versionTag: 'v3',
                previousVersionTag: 'v2',
                previousUpdated: 2000,
            });

            expect(mockPatchFile).toHaveBeenCalledTimes(2);
            const [, , instructions, metadata] = mockPatchFile.mock.calls[1];
            expect(instructions.versionTag).toBe('v2');
            expect(metadata.versionTag).toBe('v2');
            expect(metadata.appData.groupId).toBe('folder-7');
            expect(metadata.accessControlList).toEqual({ requiredSecurityGroup: SecurityGroupType.Owner });
            expect(JSON.parse(metadata.appData.content)).toMatchObject({ title: 'Peer title', isCollaborative: false });
        });

        it('fails, instead of doing nothing, when the retry conflicts too', async () => {
            serveNote(noteHeader('object', { acl: sharedAcl }));
            conflictOnce(() => {});
            conflictOnce(() => {});

            await expect(provider.revokeNoteCollaboration(NOTE_ID, 'me.id', undefined, 'folder-7')).rejects.toThrow('versionTagMismatch');
            expect(mockPatchFile).toHaveBeenCalledTimes(2);
        });
    });

    // #760: the sync push of a just-edited note landing between the publish's header
    // fetch and its re-upload made the publish fail. It is rebuilt once from the fresh header.
    describe('makeNotePublic on a version conflict', () => {
        // The SDK hands a versionTagMismatch to the onVersionConflict argument, and throws without one.
        const conflictOnce = (onConflict: () => void) => {
            mockReUpload.mockImplementationOnce(async (...args: unknown[]) => {
                onConflict();
                const handler = args[4] as (() => Promise<unknown>) | undefined;
                if (!handler) throw new Error('versionTagMismatch');
                return handler();
            });
        };

        it('re-uploads against the fresh header and still publishes', async () => {
            let current = noteHeader('object');
            mockGetHeader.mockImplementation(async (_c: unknown, _d: unknown, uniqueId: string) =>
                uniqueId === NOTE_ID ? current : null
            );
            conflictOnce(() => {
                current = noteHeader('object');
                current.fileMetadata.versionTag = 'v1b';
                current.fileMetadata.appData.content = { ...CONTENT, title: 'Pushed title' };
            });

            await expect(provider.makeNotePublic(NOTE_ID)).resolves.toMatchObject({ versionTag: 'v2', previousVersionTag: 'v1b' });

            expect(mockReUpload).toHaveBeenCalledTimes(2);
            const metadata = mockReUpload.mock.calls[1][2];
            expect(metadata.versionTag).toBe('v1b');
            expect(metadata.isEncrypted).toBe(false);
            expect(JSON.parse(metadata.appData.content)).toMatchObject({ title: 'Pushed title', isPublic: true });
        });

        it('fails when the retry conflicts too', async () => {
            serveNote(noteHeader('object'));
            conflictOnce(() => {});
            conflictOnce(() => {});

            await expect(provider.makeNotePublic(NOTE_ID)).rejects.toThrow('versionTagMismatch');
            expect(mockReUpload).toHaveBeenCalledTimes(2);
        });
    });

    it.each([
        ['makeNotePublic', () => provider.makeNotePublic(NOTE_ID), mockReUpload],
        ['makeNotePrivate', () => provider.makeNotePrivate(NOTE_ID), mockReUpload],
        ['makeNoteCollaborative', () => provider.makeNoteCollaborative(NOTE_ID, CIRCLE_SHARE, 'me.id'), mockPatchFile],
        ['revokeNoteCollaboration', () => provider.revokeNoteCollaboration(NOTE_ID, 'me.id', undefined, 'folder-7'), mockPatchFile],
    ] as const)('%s keeps a trashed note trashed', async (_name, run, writer) => {
        const header = noteHeader('object');
        (header.fileMetadata.appData as Record<string, unknown>).archivalStatus = 2;
        serveNote(header);

        await run();

        const metadata = writer.mock.calls[0][writer === mockReUpload ? 2 : 3];
        expect(metadata.appData.archivalStatus).toBe(2);
    });
});
