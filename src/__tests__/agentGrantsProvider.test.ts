/**
 * AgentGrantsDriveProvider wiring: fixed uniqueId, fileType 607 / dataType 708,
 * encrypted Owner-ACL payload under 'jrnl_grt'. Mirrors the mocking pattern in
 * updateNotePublic.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeDotYouClient } from './fakes';
import { SecurityGroupType } from '@homebase-id/js-lib/core';
import { EMPTY_GRANTS, parseGrants, type AgentGrants } from '@/lib/agent/grants';
import {
    AGENT_GRANTS_FILE_TYPE,
    AGENT_GRANTS_DATA_TYPE,
    AGENT_GRANTS_UNIQUE_ID,
    PAYLOAD_KEY_AGENT_GRANTS,
} from '@/lib/homebase/config';

const { mockUpload, mockPatch, mockGetHeaderByUniqueId, mockGetHeader, mockGetPayloadBytes } = vi.hoisted(() => ({
    mockUpload: vi.fn(),
    mockPatch: vi.fn(),
    mockGetHeaderByUniqueId: vi.fn(),
    mockGetHeader: vi.fn(),
    mockGetPayloadBytes: vi.fn(),
}));

vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        uploadFile: mockUpload,
        patchFile: mockPatch,
        getFileHeaderByUniqueId: mockGetHeaderByUniqueId,
        getFileHeader: mockGetHeader,
        getPayloadBytes: mockGetPayloadBytes,
    };
});

import { AgentGrantsDriveProvider } from '@/lib/homebase/AgentGrantsDriveProvider';

const fakeClient = fakeDotYouClient();

const uploadMeta = () => mockUpload.mock.calls[0][2];
const uploadPayloads = () => mockUpload.mock.calls[0][3];
const patchMeta = () => mockPatch.mock.calls[0][3];
const patchPayloads = () => mockPatch.mock.calls[0][4];
const patchInstructions = () => mockPatch.mock.calls[0][2];

const someGrants: AgentGrants = {
    version: 1,
    folders: { 'folder-1': 'read' },
    notes: { 'note-1': 'write' },
};

describe('AgentGrantsDriveProvider.load', () => {
    let provider: AgentGrantsDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        provider = new AgentGrantsDriveProvider(fakeClient);
    });

    it('returns EMPTY_GRANTS with no fileId/versionTag when there is no grants file yet', async () => {
        mockGetHeaderByUniqueId.mockResolvedValue(null);

        const result = await provider.load();

        expect(result.grants).toEqual(EMPTY_GRANTS);
        expect(result.fileId).toBeUndefined();
        expect(result.versionTag).toBeUndefined();
        expect(mockGetHeaderByUniqueId).toHaveBeenCalledWith(
            fakeClient,
            expect.anything(),
            AGENT_GRANTS_UNIQUE_ID
        );
    });
});

describe('AgentGrantsDriveProvider.save — create (no fileId)', () => {
    let provider: AgentGrantsDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockUpload.mockResolvedValue({ file: { fileId: 'new-file' }, newVersionTag: 'v1' });
        provider = new AgentGrantsDriveProvider(fakeClient);
    });

    it('calls uploadFile with the fixed uniqueId, fileType 607, dataType 708, isEncrypted and Owner ACL', async () => {
        const result = await provider.save(someGrants);

        expect(uploadMeta().appData.uniqueId).toBe(AGENT_GRANTS_UNIQUE_ID);
        expect(uploadMeta().appData.fileType).toBe(AGENT_GRANTS_FILE_TYPE);
        expect(uploadMeta().appData.dataType).toBe(AGENT_GRANTS_DATA_TYPE);
        expect(uploadMeta().isEncrypted).toBe(true);
        expect(uploadMeta().accessControlList.requiredSecurityGroup).toBe(SecurityGroupType.Owner);
        expect(result).toEqual({ fileId: 'new-file', versionTag: 'v1' });
    });

    it('writes the grants JSON to a jrnl_grt payload whose content round-trips through load', async () => {
        await provider.save(someGrants);

        const payload = uploadPayloads()[0];
        expect(payload.key).toBe(PAYLOAD_KEY_AGENT_GRANTS);
        expect(payload.iv).toBeDefined();

        const uploadedJson = JSON.parse(await payload.payload.text());
        expect(parseGrants(uploadedJson)).toEqual(someGrants);

        // Wire that same payload through load() to prove the round trip end to end.
        mockGetHeaderByUniqueId.mockResolvedValue({
            fileId: 'new-file',
            fileMetadata: { versionTag: 'v1' },
        });
        mockGetPayloadBytes.mockResolvedValue({
            bytes: new TextEncoder().encode(JSON.stringify(uploadedJson)),
            contentType: 'application/json',
        });

        const loaded = await provider.load();
        expect(loaded.grants).toEqual(someGrants);
        expect(loaded.fileId).toBe('new-file');
        expect(loaded.versionTag).toBe('v1');
    });
});

describe('AgentGrantsDriveProvider.save — update (with fileId)', () => {
    let provider: AgentGrantsDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetHeader.mockResolvedValue({ sharedSecretEncryptedKeyHeader: undefined });
        mockPatch.mockResolvedValue({ newVersionTag: 'v2' });
        provider = new AgentGrantsDriveProvider(fakeClient);
    });

    it('calls patchFile with the given versionTag and existing fileId', async () => {
        const result = await provider.save(someGrants, 'v1', 'existing-file');

        expect(patchInstructions().versionTag).toBe('v1');
        expect(patchInstructions().file).toEqual({ fileId: 'existing-file', targetDrive: expect.anything() });
        expect(patchMeta().versionTag).toBe('v1');
        expect(patchPayloads()[0].key).toBe(PAYLOAD_KEY_AGENT_GRANTS);
        expect(result).toEqual({ fileId: 'existing-file', versionTag: 'v2' });
    });
});
