import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiType } from '@homebase-id/js-lib/core';

// Mock the three SDK reads the public-note path uses; keep the real DotYouClient
// and ApiType so we can assert the anonymous Guest client is used.
const { mockGetHeader, mockGetContent, mockGetPayload } = vi.hoisted(() => ({
    mockGetHeader: vi.fn(),
    mockGetContent: vi.fn(),
    mockGetPayload: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        getFileHeaderByUniqueId: mockGetHeader,
        getContentFromHeaderOrPayload: mockGetContent,
        getPayloadBytes: mockGetPayload,
    };
});
vi.mock('@/lib/yjs-utils', () => ({
    extractMarkdownFromYjs: vi.fn(async () => '# Hello\n\nbody'),
}));

import { shareProvider } from '@/lib/providers/ShareProvider';

const IDENTITY = 'alice.dotyou.cloud';
const NOTE_ID = 'note-abc';

function header() {
    return {
        fileId: 'file-xyz',
        fileMetadata: {
            transitUpdated: 1700000000000,
            appData: {
                userDate: 1690000000000,
                content: JSON.stringify({ title: 'Public Note', tags: [] }),
            },
        },
    };
}

describe('ShareProvider.getPublicNote', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetContent.mockResolvedValue({ title: 'Public Note', tags: [] });
    });

    it('returns the note title and markdown content for an anonymous reader', async () => {
        mockGetHeader.mockResolvedValue(header());
        mockGetPayload.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) });

        const note = await shareProvider.getPublicNote(IDENTITY, NOTE_ID);

        expect(note).not.toBeNull();
        expect(note!.title).toBe('Public Note');
        expect(note!.content).toContain('Hello');
    });

    it('reads via an anonymous Guest client pointed at the author, without decryption', async () => {
        mockGetHeader.mockResolvedValue(header());
        mockGetPayload.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) });

        await shareProvider.getPublicNote(IDENTITY, NOTE_ID);

        // public notes are unencrypted — fetched with decrypt:false
        expect(mockGetHeader.mock.calls[0][3]).toMatchObject({ decrypt: false });
        expect(mockGetPayload.mock.calls[0][4]).toMatchObject({ decrypt: false });
        // and via a Guest client aimed at the author's identity
        const client = mockGetHeader.mock.calls[0][0];
        expect(client.getType()).toBe(ApiType.Guest);
        expect(client.getHostIdentity()).toBe(IDENTITY);
    });

    it('returns null for a trashed note (archivalStatus 2), even though its ACL is still Anonymous', async () => {
        mockGetHeader.mockResolvedValue({
            fileId: 'file-xyz',
            fileMetadata: {
                transitUpdated: 1700000000000,
                appData: {
                    userDate: 1690000000000,
                    archivalStatus: 2,
                    content: JSON.stringify({ title: 'Trashed Public Note', tags: [] }),
                },
            },
        });

        const note = await shareProvider.getPublicNote(IDENTITY, NOTE_ID);

        expect(note).toBeNull();
        expect(mockGetPayload).not.toHaveBeenCalled();
    });

    it('returns null when the note does not exist (header null / 404)', async () => {
        mockGetHeader.mockResolvedValue(null);

        const note = await shareProvider.getPublicNote(IDENTITY, NOTE_ID);

        expect(note).toBeNull();
        expect(mockGetPayload).not.toHaveBeenCalled();
    });

    it('throws a clear, non-retryable error when the note is not public (403)', async () => {
        mockGetHeader.mockRejectedValue({ response: { status: 403 } });

        await expect(shareProvider.getPublicNote(IDENTITY, NOTE_ID)).rejects.toThrow(
            /not shared|not public|private/i
        );
        // tagged so the query hook can skip retrying a definitive "not public" result
        await expect(shareProvider.getPublicNote(IDENTITY, NOTE_ID)).rejects.toHaveProperty(
            'isForbidden',
            true
        );
    });

    it('returns the note with empty content when the payload is missing', async () => {
        mockGetHeader.mockResolvedValue(header());
        mockGetPayload.mockResolvedValue(null);

        const note = await shareProvider.getPublicNote(IDENTITY, NOTE_ID);

        expect(note).not.toBeNull();
        expect(note!.title).toBe('Public Note');
        expect(note!.content).toBe('');
    });

    it('returns null on a network error', async () => {
        mockGetHeader.mockRejectedValue(new Error('Network Error'));

        const note = await shareProvider.getPublicNote(IDENTITY, NOTE_ID);

        expect(note).toBeNull();
    });
});
