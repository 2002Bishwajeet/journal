/**
 * Security (SEC-02): a PUBLIC note's appData.content is stored as world-readable
 * plaintext. It must NOT carry the owner's social graph — `recipients` (odinIds
 * the note was shared with), `circleIds`, or `lastEditedBy`. Both write paths that
 * can produce public content (updateNote and makeNotePublic) must project to a
 * minimal, non-sensitive subset. A PRIVATE note keeps the full object (encrypted),
 * so making a note private again restores those fields.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import type { DocumentMetadata } from '@/types';
import { fakeDotYouClient } from './fakes';

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
        // Make public/private re-upload via uploadFile (#451); keep reUploadFile's
        // (client, instructions, metadata, encrypt) shape for the assertions below.
        uploadFile: (...args: unknown[]) => mockReUpload(args[0], args[1], args[2], args[5]),
    };
});

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';

const NOTE_ID = '11111111-1111-1111-1111-111111111111';
const fakeClient = fakeDotYouClient();

function meta(over: Partial<DocumentMetadata>): DocumentMetadata {
    return { title: 'Note', tags: [], ...over } as DocumentMetadata;
}

const SOCIAL = {
    circleIds: ['circle-1'],
    recipients: ['friend.dotyou.cloud'],
    lastEditedBy: 'friend.dotyou.cloud',
};

function paragraphBlob(text: string): Uint8Array {
    const doc = new Y.Doc();
    const p = new Y.XmlElement('paragraph');
    doc.getXmlFragment('prosemirror').insert(0, [p]);
    const t = new Y.XmlText();
    p.insert(0, [t]);
    t.insert(0, text);
    return Y.encodeStateAsUpdate(doc);
}

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

    it('publishes a link card description for a PUBLIC note without leaking the social graph', async () => {
        await provider.updateNote(
            NOTE_ID, 'file-1', 'v1',
            meta({ isPublic: true, ...SOCIAL }),
            undefined, undefined, paragraphBlob('First paragraph text')
        );

        const content = updateContent();
        expect(content.card.description).toBe('First paragraph text');
        expect(content).not.toHaveProperty('circleIds');
        expect(content).not.toHaveProperty('recipients');
        expect(content).not.toHaveProperty('lastEditedBy');
    });

    it('never adds a card to a PRIVATE note content', async () => {
        await provider.updateNote(
            NOTE_ID, 'file-1', 'v1',
            meta({ isPublic: false, shareDescription: 'Blurb', ...SOCIAL }),
            undefined, undefined, paragraphBlob('First paragraph text')
        );

        const content = updateContent();
        expect(content).not.toHaveProperty('card');
        expect(content.shareDescription).toBe('Blurb');
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
