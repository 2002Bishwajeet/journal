/**
 * Regression: editing a PUBLIC note used to fail. updateNote hardcoded
 * isEncrypted:true + Owner ACL and passed a cached key header, so saving a public
 * (Anonymous, unencrypted) note tried to encrypt it with a key the file doesn't
 * have — the SDK rejected the patch (or silently reverted the share). The save
 * path must mirror makeNotePublic: Anonymous ACL, isEncrypted:false, no key header.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { SecurityGroupType } from '@homebase-id/js-lib/core';
import type { EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import type { DocumentMetadata } from '@/types';

const { mockPatch } = vi.hoisted(() => ({ mockPatch: vi.fn() }));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return { ...actual, patchFile: mockPatch };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';

const NOTE_ID = '11111111-1111-1111-1111-111111111111';
const fakeClient = { getHostIdentity: () => 'me.dotyou.cloud' } as unknown as DotYouClient;
const fakeKeyHeader = { encryptionVersion: 1 } as unknown as EncryptedKeyHeader;

function meta(over: Partial<DocumentMetadata>): DocumentMetadata {
    return { title: 'Note', tags: [], ...over } as DocumentMetadata;
}

// patchFile args: (client, keyHeader, instructions, uploadMetadata, payloads, ...)
const keyHeaderArg = () => mockPatch.mock.calls[0][1];
const uploadMeta = () => mockPatch.mock.calls[0][3];
const payloadsArg = () => mockPatch.mock.calls[0][4];
const yjs = () => new Uint8Array([1, 2, 3]);

describe('NotesDriveProvider.updateNote — encryption/ACL by visibility', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockPatch.mockResolvedValue({ newVersionTag: 'v2' });
        provider = new NotesDriveProvider(fakeClient);
    });

    it('saves a PUBLIC note unencrypted, Anonymous, with no key header', async () => {
        await provider.updateNote(NOTE_ID, 'file-1', 'v1', meta({ isPublic: true }),
            undefined, undefined, undefined, fakeKeyHeader);

        expect(uploadMeta().isEncrypted).toBe(false);
        expect(uploadMeta().accessControlList.requiredSecurityGroup).toBe(SecurityGroupType.Anonymous);
        expect(keyHeaderArg()).toBeUndefined();
    });

    it('saves a PRIVATE note encrypted, Owner, keeping the key header', async () => {
        await provider.updateNote(NOTE_ID, 'file-1', 'v1', meta({ isPublic: false }),
            undefined, undefined, undefined, fakeKeyHeader);

        expect(uploadMeta().isEncrypted).toBe(true);
        expect(uploadMeta().accessControlList.requiredSecurityGroup).toBe(SecurityGroupType.Owner);
        expect(keyHeaderArg()).toBe(fakeKeyHeader);
    });

    it('saves a COLLABORATIVE note encrypted with Connected ACL', async () => {
        await provider.updateNote(NOTE_ID, 'file-1', 'v1',
            meta({ isCollaborative: true, circleIds: ['circle-1'] }),
            undefined, undefined, undefined, fakeKeyHeader);

        expect(uploadMeta().isEncrypted).toBe(true);
        expect(uploadMeta().accessControlList.requiredSecurityGroup).toBe(SecurityGroupType.Connected);
    });

    // Regression: syncing a PUBLIC note's content used to attach a payload IV to an
    // unencrypted file, which the server rejects (400 invalidUpload, "All payload IVs
    // must be 0 bytes when server file header is not encrypted").
    it('omits the payload IV when saving a PUBLIC note (unencrypted)', async () => {
        await provider.updateNote(NOTE_ID, 'file-1', 'v1', meta({ isPublic: true }),
            undefined, undefined, yjs(), fakeKeyHeader);

        expect(uploadMeta().isEncrypted).toBe(false);
        expect(payloadsArg()[0].iv).toBeUndefined();
    });

    it('attaches a payload IV when saving a PRIVATE note (encrypted)', async () => {
        await provider.updateNote(NOTE_ID, 'file-1', 'v1', meta({ isPublic: false }),
            undefined, undefined, yjs(), fakeKeyHeader);

        expect(uploadMeta().isEncrypted).toBe(true);
        expect(payloadsArg()[0].iv).toBeDefined();
    });
});
