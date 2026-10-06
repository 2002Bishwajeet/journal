import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { setCover } from '@/lib/editor/cover';
import { BLOCK_STATE_MAP } from '@/lib/liveBlockState';

// Spy on the decode: wraps the real Y.applyUpdate.
vi.mock('yjs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('yjs')>();
    return { ...actual, applyUpdate: vi.fn(actual.applyUpdate) };
});

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

import { shareProvider } from '@/lib/providers/ShareProvider';
import { buildPublicCard } from '@/lib/share/publicCard';

function blob(): Uint8Array {
    const doc = new Y.Doc();
    setCover(doc, { src: 'attachment://file-xyz/cover-key', positionY: 40 });
    doc.getMap(BLOCK_STATE_MAP).set('k3f9', '{"count":3}');
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('Hello world')]);
    doc.getXmlFragment('prosemirror').insert(0, [p]);
    return Y.encodeStateAsUpdate(doc);
}

describe('decoding the note blob once', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('ShareProvider decodes once and still returns markdown, cover and block states', async () => {
        mockGetHeader.mockResolvedValue({
            fileId: 'file-xyz',
            fileMetadata: { appData: { userDate: 1690000000000, content: '{}' } },
        });
        mockGetContent.mockResolvedValue({ title: 'T', tags: [] });
        const bytes = blob();
        mockGetPayload.mockResolvedValue({ bytes });
        vi.mocked(Y.applyUpdate).mockClear();

        const note = await shareProvider.getPublicNote('alice.dotyou.cloud', 'note-abc');

        expect(Y.applyUpdate).toHaveBeenCalledTimes(1);
        expect(note!.content).toContain('Hello world');
        expect(note!.cover).toEqual({ src: 'attachment://file-xyz/cover-key', positionY: 40 });
        expect(note!.blockStates).toEqual({ k3f9: '{"count":3}' });
    });

    it('buildPublicCard decodes once and still returns description and cover', () => {
        const bytes = blob();
        vi.mocked(Y.applyUpdate).mockClear();

        const card = buildPublicCard(bytes, {});

        expect(Y.applyUpdate).toHaveBeenCalledTimes(1);
        expect(card.description).toBe('Hello world');
        expect(card.coverKey).toBe('cover-key');
    });
});
