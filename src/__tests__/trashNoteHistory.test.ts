// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

const { setNoteArchivalStatusRemote } = vi.hoisted(() => ({ setNoteArchivalStatusRemote: vi.fn() }));
vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
vi.mock('@/hooks/useSyncService', () => ({
    useSyncService: () => ({ deleteNoteRemote: vi.fn(), setNoteArchivalStatusRemote }),
}));
vi.mock('@/hooks/useLiveQuery', () => ({ useLiveQuery: () => ({ data: [], isLoading: false }) }));
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({}) }));

import { setTestDb } from './pgliteMock';
import { getSearchIndexEntry, getSnapshots, saveSnapshot, upsertSearchIndex } from '@/lib/db/queries';
import { useNotes } from '@/hooks/useNotes';

const NOTE = '40000000-0000-0000-0000-000000000001';
const OTHER = '40000000-0000-0000-0000-000000000002';
const snap = { stateBlob: new Uint8Array([1]), stateVector: new Uint8Array([1]), preview: '', wordCount: 0 };

async function addNote(docId: string) {
    const now = new Date().toISOString();
    await upsertSearchIndex({
        docId,
        title: 'Note',
        plainTextContent: '',
        metadata: { title: 'Note', folderId: 'main', timestamps: { created: now, modified: now }, excludeFromAI: false },
    });
    await saveSnapshot(docId, snap);
}

async function renderUseNotes() {
    let api!: ReturnType<typeof useNotes>;
    const Probe = () => {
        api = useNotes();
        return null;
    };
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(h(QueryClientProvider, { client: new QueryClient() }, h(Probe))));
    return { api, unmount: () => act(() => root.unmount()) };
}

beforeAll(async () => { setTestDb(await createTestDatabase()); });
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => {
    await resetTestDatabase();
    setNoteArchivalStatusRemote.mockReset().mockResolvedValue(undefined);
    await addNote(NOTE);
    await addNote(OTHER);
});

describe('trashing a note and its version history (#1070)', () => {
    it("drops the note's snapshots once the server confirms the trash, and keeps other notes' snapshots", async () => {
        const { api, unmount } = await renderUseNotes();

        await api.trashNote.mutateAsync(NOTE);

        expect(await getSnapshots(NOTE)).toEqual([]);
        expect(await getSnapshots(OTHER)).toHaveLength(1);

        // Restore works, with an empty history
        await api.restoreNote.mutateAsync(NOTE);
        expect((await getSearchIndexEntry(NOTE))?.metadata.archivalStatus).toBe(0);
        expect(await getSnapshots(NOTE)).toEqual([]);
        unmount();
    });

    it('a trash the server refuses rolls the note back with its snapshots intact', async () => {
        setNoteArchivalStatusRemote.mockRejectedValueOnce(new Error('offline'));
        const { api, unmount } = await renderUseNotes();

        await expect(api.trashNote.mutateAsync(NOTE)).rejects.toThrow('offline');

        expect((await getSearchIndexEntry(NOTE))?.metadata.archivalStatus).toBe(0);
        expect(await getSnapshots(NOTE)).toHaveLength(1);
        unmount();
    });

    it('archiving keeps the history', async () => {
        const { api, unmount } = await renderUseNotes();

        await api.archiveNote.mutateAsync(NOTE);

        expect(await getSnapshots(NOTE)).toHaveLength(1);
        unmount();
    });
});
