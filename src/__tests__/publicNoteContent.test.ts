/**
 * Security (SEC-02): a PUBLIC note's appData.content is stored as world-readable
 * plaintext. It must NOT carry the owner's social graph — `recipients` (odinIds
 * the note was shared with), `circleIds`, or `lastEditedBy`. Both write paths that
 * can produce public content (updateNote and makeNotePublic) must project to a
 * minimal, non-sensitive subset. A PRIVATE note keeps the full object (encrypted),
 * so making a note private again restores those fields.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import type { DocumentMetadata } from '@/types';

const { mockPatch, mockGetHeader, mockReUpload } = vi.hoisted(() => ({
    mockPatch: vi.fn(),
    mockGetHeader: vi.fn(),
    mockReUpload: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        patchFile: mockPatch,
        getFileHeaderByUniqueId: mockGetHeader,
        reUploadFile: mockReUpload,
    };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';

const NOTE_ID = '11111111-1111-1111-1111-111111111111';
const fakeClient = { getHostIdentity: () => 'me.dotyou.cloud' } as unknown as DotYouClient;

function meta(over: Partial<DocumentMetadata>): DocumentMetadata {
    return { title: 'Note', tags: [], ...over } as DocumentMetadata;
}

const SOCIAL = {
    circleIds: ['circle-1'],
    recipients: ['friend.dotyou.cloud'],
    lastEditedBy: 'friend.dotyou.cloud',
};

// patchFile args: (client, keyHeader, instructions, uploadMetadata, payloads, ...)
const updateContent = () => JSON.parse(mockPatch.mock.calls[0][3].appData.content);

describe('NotesDriveProvider.updateNote — public content projection (SEC-02)', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockPatch.mockResolvedValue({ newVersionTag: 'v2' });
        provider = new NotesDriveProvider(fakeClient);
    });

    it('omits recipients/circleIds/lastEditedBy from a PUBLIC note content', async () => {
        await provider.updateNote(
            NOTE_ID, 'file-1', 'v1',
            meta({ isPublic: true, ...SOCIAL })
        );

        const content = updateContent();
        expect(content.recipients).toBeUndefined();
        expect(content.circleIds).toBeUndefined();
        expect(content.lastEditedBy).toBeUndefined();
        // Public page still needs these.
        expect(content.title).toBe('Note');
        expect(content.isPublic).toBe(true);
        // Serialized keys must not include the sensitive ones at all.
        expect(Object.keys(content)).not.toEqual(
            expect.arrayContaining(['recipients', 'circleIds', 'lastEditedBy'])
        );
    });

    it('keeps the full object for a PRIVATE note (round-trip restore)', async () => {
        await provider.updateNote(
            NOTE_ID, 'file-1', 'v1',
            meta({ isPublic: false, ...SOCIAL })
        );

        const content = updateContent();
        expect(content.recipients).toEqual(['friend.dotyou.cloud']);
        expect(content.circleIds).toEqual(['circle-1']);
        expect(content.lastEditedBy).toBe('friend.dotyou.cloud');
    });
});

// makeNotePublic re-uploads the header's existing content as plaintext.
function ownerHeader() {
    return {
        fileId: 'file-1',
        fileMetadata: {
            versionTag: 'v1',
            appData: {
                uniqueId: NOTE_ID,
                groupId: 'folder-7',
                userDate: 1690000000000,
                tags: ['tag-a'],
                content: {
                    title: 'My Secret Note',
                    tags: ['tag-a'],
                    excludeFromAI: false,
                    ...SOCIAL,
                },
            },
        },
    };
}

describe('NotesDriveProvider.makeNotePublic — public content projection (SEC-02)', () => {
    let provider: NotesDriveProvider;
    beforeEach(() => {
        vi.clearAllMocks();
        mockReUpload.mockResolvedValue({ newVersionTag: 'v2' });
        provider = new NotesDriveProvider(fakeClient);
    });

    it('strips recipients/circleIds/lastEditedBy when publishing', async () => {
        mockGetHeader.mockResolvedValue(ownerHeader());

        await provider.makeNotePublic(NOTE_ID);

        const content = JSON.parse(mockReUpload.mock.calls[0][2].appData.content);
        expect(content.recipients).toBeUndefined();
        expect(content.circleIds).toBeUndefined();
        expect(content.lastEditedBy).toBeUndefined();
        expect(content.title).toBe('My Secret Note');
        expect(content.isPublic).toBe(true);
    });
});
