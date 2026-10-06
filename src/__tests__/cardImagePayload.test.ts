/**
 * #441: a public note with an uploaded cover gets a 1200×630 card image, stored as its own
 * `jrnl_card` payload. It is drawn at publish, redrawn on a save only when the cover's src
 * or positionY changed since the last one, and removed with the cover or the share.
 * Drawing needs a canvas, so the renderer is stubbed; the drive SDK is stubbed at its calls.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { fakeDotYouClient } from './fakes';
import { setCover } from '@/lib/editor/cover';
import type { DocumentMetadata } from '@/types';

const { mockGetHeader, mockPatch, mockUpload, mockGetPayload, mockGetThumb, mockRender, mockCanRender } = vi.hoisted(() => ({
    mockGetHeader: vi.fn(),
    mockPatch: vi.fn(),
    mockUpload: vi.fn(),
    mockGetPayload: vi.fn(),
    mockGetThumb: vi.fn(),
    mockRender: vi.fn(),
    mockCanRender: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return {
        ...actual,
        getFileHeader: mockGetHeader,
        getFileHeaderByUniqueId: mockGetHeader,
        patchFile: mockPatch,
        uploadFile: mockUpload,
        getPayloadBytes: mockGetPayload,
        getThumbBytes: mockGetThumb,
    };
});
vi.mock('@/lib/share/cardImage', () => ({ renderCardImage: mockRender, canRenderCardImage: mockCanRender }));

import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { buildPublicCard, type CardImageFrom } from '@/lib/share/publicCard';

const NOTE_ID = '44144144-1441-4414-4144-144144144144';
const FILE_ID = 'file-441';
const COVER = `attachment://${FILE_ID}/jrnl_img0`;
const COVER_BYTES = new Uint8Array([1, 2, 3]);
const CARD_BYTES = new Uint8Array([9, 9]);
const client = fakeDotYouClient();

function noteBlob(cover?: { src: string; positionY: number }): Uint8Array {
    const doc = new Y.Doc();
    if (cover) setCover(doc, cover);
    return Y.encodeStateAsUpdate(doc);
}

function header(payloadKeys: string[], cardImageFrom?: CardImageFrom) {
    return {
        fileId: FILE_ID,
        fileMetadata: {
            versionTag: 'v1',
            isEncrypted: false,
            appData: {
                uniqueId: NOTE_ID,
                groupId: 'main',
                content: JSON.stringify({ title: 'Note', isPublic: true, card: cardImageFrom && { cardImageFrom } }),
            },
            payloads: payloadKeys.map((key) => ({ key, contentType: 'image/png', lastModified: 7, thumbnails: [] })),
        },
        serverMetadata: { accessControlList: { requiredSecurityGroup: 'anonymous' } },
    };
}

const publicMeta = { title: 'Note', tags: [], isPublic: true } as unknown as DocumentMetadata;
const save = (blob: Uint8Array, metadata: DocumentMetadata = publicMeta) =>
    new NotesDriveProvider(client).updateNote(NOTE_ID, FILE_ID, 'v1', metadata, undefined, undefined, blob);

// patchFile args: (client, keyHeader, instructions, uploadMetadata, payloads, thumbnails, toDeletePayloads, onVersionConflict)
const patchedKeys = () => (mockPatch.mock.calls[0][4] as Array<{ key: string }>).map((p) => p.key);
const patchedCardImage = () => (mockPatch.mock.calls[0][4] as Array<{ key: string; payload: Blob }>).find((p) => p.key === 'jrnl_card');
const patchedDeletes = () => (mockPatch.mock.calls[0][6] as Array<{ key: string }> | undefined)?.map((p) => p.key) ?? [];
const patchedCard = () => JSON.parse(mockPatch.mock.calls[0][3].appData.content).card;
// uploadFile args: (client, instructions, metadata, payloads, thumbnails, encrypt)
const uploadedKeys = () => (mockUpload.mock.calls[0][3] as Array<{ key: string }>).map((p) => p.key);

let renderedImage: Blob;
beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderedImage = new Blob([new Uint8Array([4, 4])], { type: 'image/jpeg' });
    mockPatch.mockResolvedValue({ newVersionTag: 'v2' });
    mockUpload.mockResolvedValue({ newVersionTag: 'v2' });
    mockCanRender.mockReturnValue(true);
    mockRender.mockResolvedValue(renderedImage);
    mockGetThumb.mockResolvedValue(null);
    mockGetPayload.mockImplementation(async (_c, _d, _f, key: string) => ({
        bytes: key === 'jrnl_card' ? CARD_BYTES : COVER_BYTES,
        contentType: key === 'jrnl_card' ? 'image/jpeg' : 'image/png',
    }));
});

describe('saving a public note: the card image', () => {
    it('is drawn from the uploaded cover and sent in the same patch when the file has none', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_img0']));

        await save(noteBlob({ src: COVER, positionY: 30 }));

        expect(mockGetPayload).toHaveBeenCalledWith(client, expect.anything(), FILE_ID, 'jrnl_img0', { decrypt: true, lastModified: 7 });
        const [image, positionY] = mockRender.mock.calls[0];
        expect(new Uint8Array(await (image as Blob).arrayBuffer())).toEqual(COVER_BYTES);
        expect(positionY).toBe(30);
        expect(mockPatch).toHaveBeenCalledTimes(1);
        expect(patchedCardImage()?.payload).toBe(renderedImage);
        expect(patchedCard()).toMatchObject({
            coverKey: 'jrnl_img0',
            cardImageKey: 'jrnl_card',
            cardImageFrom: { src: COVER, positionY: 30 },
        });
    });

    it('is left alone on a plain edit: same cover and positionY as the last one drawn', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_img0', 'jrnl_card'], { src: COVER, positionY: 30 }));

        await save(noteBlob({ src: COVER, positionY: 30 }));

        expect(mockRender).not.toHaveBeenCalled();
        expect(mockGetPayload).not.toHaveBeenCalled();
        expect(patchedKeys()).not.toContain('jrnl_card');
        expect(patchedDeletes()).not.toContain('jrnl_card');
        expect(patchedCard().cardImageKey).toBe('jrnl_card');
    });

    it('is redrawn when positionY changed', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_img0', 'jrnl_card'], { src: COVER, positionY: 30 }));

        await save(noteBlob({ src: COVER, positionY: 100 }));

        expect(mockRender.mock.calls[0][1]).toBe(100);
        expect(patchedKeys()).toContain('jrnl_card');
        expect(patchedCard().cardImageFrom).toEqual({ src: COVER, positionY: 100 });
    });

    it('is redrawn from the new cover when the cover was replaced', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_img0', 'jrnl_img1', 'jrnl_card'], { src: COVER, positionY: 30 }));

        await save(noteBlob({ src: `attachment://${FILE_ID}/jrnl_img1`, positionY: 30 }));

        expect(mockGetPayload).toHaveBeenCalledWith(client, expect.anything(), FILE_ID, 'jrnl_img1', expect.anything());
        expect(patchedKeys()).toContain('jrnl_card');
    });

    it('is deleted, and dropped from the card, when the cover was removed', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_card'], { src: COVER, positionY: 30 }));

        await save(noteBlob());

        expect(patchedDeletes()).toEqual(['jrnl_card']);
        expect(patchedKeys()).not.toContain('jrnl_card');
        expect(patchedCard()).toBeUndefined();
    });

    it('is not deleted when the file has none', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt']));

        await save(noteBlob());

        expect(patchedDeletes()).toEqual([]);
    });

    it('keeps the deletions the save already had', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_img0', 'jrnl_card'], { src: COVER, positionY: 30 }));

        await new NotesDriveProvider(client).updateNote(NOTE_ID, FILE_ID, 'v1', publicMeta, undefined, undefined, noteBlob(),
            undefined, { toDeletePayloads: [{ key: 'jrnl_img0' }] });

        expect(patchedDeletes()).toEqual(['jrnl_img0', 'jrnl_card']);
    });

    it('is not drawn from a cover on another file, and a stale one is deleted', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_card'], { src: COVER, positionY: 30 }));

        await save(noteBlob({ src: 'attachment://other-file/jrnl_img0', positionY: 30 }));

        expect(mockRender).not.toHaveBeenCalled();
        expect(patchedDeletes()).toEqual(['jrnl_card']);
    });

    it('never fails the save when drawing fails, and deletes the stale one', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_img0', 'jrnl_card'], { src: COVER, positionY: 30 }));
        mockRender.mockRejectedValue(new Error('decode failed'));

        await save(noteBlob({ src: COVER, positionY: 60 }));

        expect(patchedKeys()).not.toContain('jrnl_card');
        expect(patchedDeletes()).toEqual(['jrnl_card']);
    });

    it('is skipped where the browser cannot draw it', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_img0']));
        mockCanRender.mockReturnValue(false);

        await save(noteBlob({ src: COVER, positionY: 30 }));

        expect(mockGetPayload).not.toHaveBeenCalled();
        expect(patchedKeys()).not.toContain('jrnl_card');
    });

    it('is not looked at for a private note', async () => {
        await save(noteBlob({ src: COVER, positionY: 30 }), { title: 'Note', tags: [] } as unknown as DocumentMetadata);

        expect(mockGetHeader).not.toHaveBeenCalled();
        expect(patchedKeys()).not.toContain('jrnl_card');
    });
});

describe('making a note public or private: the card image', () => {
    it('is drawn at publish from the cover bytes the re-upload read, replacing an old one', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_img0', 'jrnl_card']));
        const card = buildPublicCard(noteBlob({ src: COVER, positionY: 0 }), {});

        await new NotesDriveProvider(client).makeNotePublic(NOTE_ID, FILE_ID, card);

        expect(mockRender.mock.calls[0][1]).toBe(0);
        expect(new Uint8Array(await (mockRender.mock.calls[0][0] as Blob).arrayBuffer())).toEqual(COVER_BYTES);
        expect(uploadedKeys().filter((k) => k === 'jrnl_card')).toHaveLength(1);
        const uploadedCard = (mockUpload.mock.calls[0][3] as Array<{ key: string; payload: Blob }>).find((p) => p.key === 'jrnl_card');
        expect(uploadedCard?.payload).toBe(renderedImage);
        expect(JSON.parse(mockUpload.mock.calls[0][2].appData.content).card).toMatchObject({
            cardImageKey: 'jrnl_card',
            cardImageFrom: { src: COVER, positionY: 0 },
        });
    });

    it('is dropped at publish when the note has no cover', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_card']));

        await new NotesDriveProvider(client).makeNotePublic(NOTE_ID, FILE_ID, buildPublicCard(noteBlob(), {}));

        expect(mockRender).not.toHaveBeenCalled();
        expect(uploadedKeys()).toEqual(['jrnl_txt']);
    });

    it('is removed when the note is made private', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_img0', 'jrnl_card'], { src: COVER, positionY: 30 }));

        await new NotesDriveProvider(client).makeNotePrivate(NOTE_ID, FILE_ID);

        expect(uploadedKeys()).toEqual(['jrnl_txt', 'jrnl_img0']);
        expect(JSON.parse(mockUpload.mock.calls[0][2].appData.content)).not.toHaveProperty('card');
    });
});

describe('getCardImage (the share dialog preview)', () => {
    it('returns the uploaded card image when it was drawn from this cover', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_img0', 'jrnl_card'], { src: COVER, positionY: 30 }));

        const image = await new NotesDriveProvider(client).getCardImage(FILE_ID, { src: COVER, positionY: 30 });

        expect(new Uint8Array(await image!.arrayBuffer())).toEqual(CARD_BYTES);
        expect(mockRender).not.toHaveBeenCalled();
    });

    it('draws the same image locally while the uploaded one is missing or out of date', async () => {
        mockGetHeader.mockResolvedValue(header(['jrnl_txt', 'jrnl_img0', 'jrnl_card'], { src: COVER, positionY: 30 }));

        const image = await new NotesDriveProvider(client).getCardImage(FILE_ID, { src: COVER, positionY: 80 });

        expect(image).toBe(renderedImage);
        expect(mockRender.mock.calls[0][1]).toBe(80);
    });
});
