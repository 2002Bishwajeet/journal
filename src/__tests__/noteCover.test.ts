// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { PGlite } from '@electric-sql/pglite';
import type { EncryptedKeyHeader } from '@homebase-id/js-lib/core';
import * as Y from 'yjs';
import {
    COVER_MAP, getCover, setCover, clearCover, setCoverPosition, coverPayloadKey, getCoverFromBlob,
} from '@/lib/editor/cover';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { fakeDotYouClient, fakeOnlineContext } from './fakes';
import type { DocumentMetadata, SyncRecord } from '@/types';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

const { mockAddImageToNote, mockUpdateNote } = vi.hoisted(() => ({
    mockAddImageToNote: vi.fn(),
    mockUpdateNote: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: class NotesDriveProvider {
        addImageToNote = mockAddImageToNote;
        updateNote = mockUpdateNote;
        constructor() {}
    },
}));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({
    FolderDriveProvider: class FolderDriveProvider { constructor() {} },
}));
vi.mock('@/lib/homebase/InboxProcessor', () => ({
    InboxProcessor: class InboxProcessor { constructor() {} },
}));
// The editor's app-level hooks; the cover path only needs the DB and the Yjs doc.
vi.mock('@/hooks/useAISettings', () => ({
    useAISettings: () => ({ settings: { grammarEnabled: false } }),
}));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync: vi.fn(async () => {}) }) }));
vi.mock('@/hooks/useNoteTitleMap', () => ({
    useNoteTitleMap: () => ({ map: new Map(), isReady: true }),
}));
vi.mock('@/hooks/useDocumentSubscription', () => ({ useDocumentSubscription: vi.fn() }));
vi.mock('@/components/editor/hooks/useImageDeletionTracker', () => ({
    useImageDeletionTracker: vi.fn(),
}));

import {
    saveDocumentUpdate, getDocumentUpdates, upsertSyncRecord, upsertSearchIndex, getSyncRecord,
    getImageUploadsReadyForRetry, getPendingImageDeletions,
} from '@/lib/db/queries';
import { serializeKeyHeader } from '@/lib/utils';
import { documentBroadcast } from '@/lib/broadcast';
import { SyncService } from '@/lib/homebase/SyncService';
import { EditorProvider } from '@/components/editor/EditorProvider';
import { useEditorContext, type EditorContextValue } from '@/components/editor/EditorContext';

describe('note cover', () => {
    it('round-trips setCover/getCover and clears', () => {
        const doc = new Y.Doc();
        expect(getCover(doc)).toBeNull();

        setCover(doc, { src: 'blob:abc', pendingId: 'p1', positionY: 50 });
        expect(getCover(doc)).toEqual({ src: 'blob:abc', pendingId: 'p1', positionY: 50 });

        setCover(doc, { src: 'attachment://f/jrnl_img0', positionY: 20 });
        expect(getCover(doc)).toEqual({ src: 'attachment://f/jrnl_img0', positionY: 20 });

        clearCover(doc);
        expect(getCover(doc)).toBeNull();
    });

    it('returns null for a malformed map value', () => {
        const doc = new Y.Doc();
        const map = doc.getMap(COVER_MAP);
        for (const bad of [
            'attachment://f/k',
            { src: 42, positionY: 50 },
            { src: 'attachment://f/k' },
            { src: 'attachment://f/k', positionY: '50' },
            { src: 'attachment://f/k', positionY: 150 },
            { src: 'https://tracker.example/pixel.gif', positionY: 50 },
            { src: 'blob:x', pendingId: 7, positionY: 50 },
        ]) {
            map.set('cover', bad);
            expect(getCover(doc)).toBeNull();
        }
    });

    it('setCoverPosition clamps and rounds', () => {
        const doc = new Y.Doc();
        setCover(doc, { src: 'attachment://f/k', positionY: 50 });

        setCoverPosition(doc, -5);
        expect(getCover(doc)?.positionY).toBe(0);
        setCoverPosition(doc, 140);
        expect(getCover(doc)?.positionY).toBe(100);
        setCoverPosition(doc, 33.6);
        expect(getCover(doc)?.positionY).toBe(34);
    });

    it('setCoverPosition is a no-op without a cover', () => {
        const doc = new Y.Doc();
        setCoverPosition(doc, 10);
        expect(getCover(doc)).toBeNull();
    });

    it('coverPayloadKey parses attachment srcs only', () => {
        expect(coverPayloadKey('attachment://abc/jrnl_img3')).toBe('jrnl_img3');
        expect(coverPayloadKey('blob:http://localhost/abc')).toBeNull();
    });

    it('getCoverFromBlob reads the cover from an encoded doc', () => {
        const doc = new Y.Doc();
        setCover(doc, { src: 'attachment://f/jrnl_img1', positionY: 70 });
        expect(getCoverFromBlob(Y.encodeStateAsUpdate(doc))).toEqual({ src: 'attachment://f/jrnl_img1', positionY: 70 });
        expect(getCoverFromBlob(Y.encodeStateAsUpdate(new Y.Doc()))).toBeNull();
    });

    it('concurrent covers converge after exchanging updates', () => {
        const a = new Y.Doc();
        const b = new Y.Doc();
        setCover(a, { src: 'attachment://f/jrnl_img1', positionY: 10 });
        setCover(b, { src: 'attachment://f/jrnl_img2', positionY: 90 });

        const fromA = Y.encodeStateAsUpdate(a);
        const fromB = Y.encodeStateAsUpdate(b);
        Y.applyUpdate(a, fromB);
        Y.applyUpdate(b, fromA);

        expect(getCover(a)).not.toBeNull();
        expect(getCover(a)).toEqual(getCover(b));
    });
});

const DOC_ID = '11111111-1111-1111-1111-111111111111';
const FILE_ID = 'remote-file-1';
const UPLOADED = `attachment://${FILE_ID}/jrnl_img0`;
const METADATA = { title: 'Note', folderId: 'main', tags: [] } as unknown as DocumentMetadata;
const VALID_KEY_HEADER = serializeKeyHeader(
    { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' } as unknown as EncryptedKeyHeader,
);

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (!(await check())) {
        if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
        await new Promise((r) => setTimeout(r, 20));
    }
}

async function storedCover() {
    const d = new Y.Doc();
    for (const u of await getDocumentUpdates(DOC_ID)) Y.applyUpdate(d, u);
    const cover = getCover(d);
    d.destroy();
    return cover;
}

describe('note cover in the editor (real PGlite + Yjs, drive stubbed)', () => {
    let db: PGlite;
    let root: Root | undefined;
    let el: HTMLElement | undefined;
    let ctx: EditorContextValue | undefined;
    let svc: SyncService;

    function Probe() { ctx = useEditorContext(); return null; }

    /** Open the note in the editor, as the editor page does. */
    async function openNote(): Promise<EditorContextValue> {
        ctx = undefined;
        el = document.createElement('div');
        document.body.appendChild(el);
        const r = createRoot(el);
        root = r;
        await act(async () => {
            r.render(h(MemoryRouter, null,
                h(EditorProvider, { docId: DOC_ID, metadata: METADATA, children: h(Probe) })));
        });
        await waitFor(() => !!ctx?.isReady);
        return ctx!;
    }

    async function seedCover(cover: Parameters<typeof setCover>[1]): Promise<void> {
        const d = new Y.Doc();
        setCover(d, cover);
        await saveDocumentUpdate(DOC_ID, Y.encodeStateAsUpdate(d));
        d.destroy();
    }

    beforeAll(async () => {
        db = await createTestDatabase();
        setTestDb(db);
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });
    afterAll(async () => { await closeTestDatabase(); });

    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation(() => {});
        vi.spyOn(documentBroadcast, 'notifyOtherTabs').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'debug').mockImplementation(() => {});
        mockAddImageToNote.mockResolvedValue({ payloadKey: 'jrnl_img0', versionTag: 'v2' });
        mockUpdateNote.mockResolvedValue({ versionTag: 'v3' });
        await upsertSearchIndex({ docId: DOC_ID, title: 'Note', plainTextContent: '', metadata: METADATA });
        await upsertSyncRecord({
            localId: DOC_ID, entityType: 'note', remoteFileId: FILE_ID, versionTag: 'v1',
            contentHash: 'stale', encryptedKeyHeader: VALID_KEY_HEADER,
            lastSyncedAt: new Date().toISOString(), syncStatus: 'synced',
        } as SyncRecord);
        svc = new SyncService(fakeDotYouClient('sam.dotyou.cloud'), fakeOnlineContext());
    });

    afterEach(async () => {
        const r = root;
        if (r) await act(async () => r.unmount());
        el?.remove();
        root = undefined;
        el = undefined;
    });

    it('adding a cover queues its bytes and uploads them as a jrnl_img payload', async () => {
        const editor = await openNote();
        const file = new File([new Uint8Array([1, 2, 3])], 'cover.png', { type: 'image/png' });

        await act(() => editor.setCoverFromFile(file));

        expect(ctx?.cover?.src.startsWith('blob:')).toBe(true);
        const [queued] = await getImageUploadsReadyForRetry();
        expect(queued).toMatchObject({ id: ctx?.cover?.pendingId, noteDocId: DOC_ID, contentType: 'image/png' });
        await waitFor(async () => (await storedCover())?.pendingId === queued.id);

        await svc.processPendingImageUploads();

        expect(mockAddImageToNote).toHaveBeenCalledTimes(1);
        expect(mockAddImageToNote.mock.calls[0][0]).toBe(DOC_ID);
        expect(await storedCover()).toEqual({ src: UPLOADED, positionY: 50 });
    });

    it('a reposition changes the stored object-position y and marks the note pending', async () => {
        await seedCover({ src: UPLOADED, positionY: 50 });
        const editor = await openNote();
        expect(editor.cover).toEqual({ src: UPLOADED, positionY: 50 });

        act(() => editor.setCoverPosition(20));

        await waitFor(async () => (await storedCover())?.positionY === 20);
        expect((await storedCover())?.src).toBe(UPLOADED);
        await waitFor(async () => (await getSyncRecord(DOC_ID))?.syncStatus === 'pending');
    });

    it('changing the cover queues the old payload for deletion', async () => {
        await seedCover({ src: UPLOADED, positionY: 50 });
        const editor = await openNote();

        await act(() => editor.setCoverFromFile(new File([new Uint8Array([4])], 'b.png', { type: 'image/png' })));

        expect(await getPendingImageDeletions(DOC_ID)).toEqual(['jrnl_img0']);
    });

    it('changing the cover keeps the old payload until the new one has uploaded, so its key is not reused', async () => {
        await seedCover({ src: UPLOADED, positionY: 50 });
        const editor = await openNote();

        await act(() => editor.setCoverFromFile(new File([new Uint8Array([4])], 'b.png', { type: 'image/png' })));
        await waitFor(async () => !!(await storedCover())?.pendingId);

        // The note syncs before the new image uploads: the old payload must survive it,
        // or the upload (next index after the max existing key) takes the old key back.
        await svc.pushNote((await getSyncRecord(DOC_ID))!);
        const first = mockUpdateNote.mock.calls.at(-1)?.[8] as { toDeletePayloads?: { key: string }[] } | undefined;
        expect(first?.toDeletePayloads).toBeUndefined();
        expect(await getPendingImageDeletions(DOC_ID)).toEqual(['jrnl_img0']);

        mockAddImageToNote.mockResolvedValueOnce({ payloadKey: 'jrnl_img1', versionTag: 'v2' });
        await svc.processPendingImageUploads();
        expect(await storedCover()).toEqual({ src: `attachment://${FILE_ID}/jrnl_img1`, positionY: 50 });

        await svc.pushNote((await getSyncRecord(DOC_ID))!);
        const second = mockUpdateNote.mock.calls.at(-1)?.[8] as { toDeletePayloads?: { key: string }[] };
        expect(second.toDeletePayloads).toEqual([{ key: 'jrnl_img0' }]);
        expect(await getPendingImageDeletions(DOC_ID)).toEqual([]);
    });

    it('removing the cover deletes its payload on the next sync', async () => {
        await seedCover({ src: UPLOADED, positionY: 50 });
        const editor = await openNote();

        await act(() => editor.removeCover());

        expect(ctx?.cover).toBeNull();
        await waitFor(async () => (await storedCover()) === null);
        await waitFor(async () => (await getSyncRecord(DOC_ID))?.syncStatus === 'pending');

        await svc.pushNote((await getSyncRecord(DOC_ID))!);

        const options = mockUpdateNote.mock.calls[0][8] as { toDeletePayloads?: { key: string }[] };
        expect(options.toDeletePayloads).toEqual([{ key: 'jrnl_img0' }]);
        expect(await getPendingImageDeletions(DOC_ID)).toEqual([]);
    });
});
