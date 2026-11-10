// @vitest-environment happy-dom
/**
 * #1047: a link to your own note that this device hasn't synced yet waits for the first
 * sync, then fetches that one note by id, once, before it says "Note not found".
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import type { SyncResult, SyncStatus } from '@/lib/homebase/SyncService';

const mocks = vi.hoisted(() => ({
    getNote: vi.fn(),
    handleRemoteNote: vi.fn(),
    getSearchIndexEntry: vi.fn(),
    sync: {} as { syncStatus: SyncStatus; lastSyncResult: SyncResult | null },
    online: { isOnline: true },
}));
const syncService = { getNoteProvider: () => ({ getNote: mocks.getNote }), handleRemoteNote: mocks.handleRemoteNote };
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ ...mocks.sync, syncService }) }));
vi.mock('@/hooks/useOnlineContext', () => ({ useOnlineContext: () => mocks.online }));
vi.mock('@/lib/db/queries/documents', () => ({ getSearchIndexEntry: mocks.getSearchIndexEntry }));

import { useMissingNotePull, type MissingNoteState } from '@/hooks/useMissingNotePull';

const NOTE = '11111111-1111-4111-8111-111111111111';
const HEADER = { fileId: 'remote-file', fileMetadata: { appData: { uniqueId: NOTE } } };
const SYNCED: SyncResult = { pulled: { folders: 0, notes: 0 }, pushed: { folders: 0, notes: 0 }, errors: [] };

type Props = { noteId?: string; isLoading?: boolean; isLocal?: boolean };

async function mount(initial: Props = {}) {
    const seen: MissingNoteState[] = [];
    let props: Props = { noteId: NOTE, isLoading: false, isLocal: false, ...initial };
    function Probe() {
        seen.push(useMissingNotePull(props.noteId, !!props.isLoading, !!props.isLocal));
        return null;
    }
    const root = createRoot(document.createElement('div'));
    const render = () => act(async () => { root.render(h(Probe)); });
    await render();
    return {
        state: () => seen.at(-1),
        seen,
        update: async (next: Props) => { props = { ...props, ...next }; await render(); },
        rerender: render,
        unmount: () => act(async () => root.unmount()),
    };
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.sync = { syncStatus: 'idle', lastSyncResult: SYNCED };
    mocks.online.isOnline = true;
    mocks.getNote.mockResolvedValue(HEADER);
    mocks.handleRemoteNote.mockResolvedValue(undefined);
    mocks.getSearchIndexEntry.mockResolvedValue({ docId: NOTE });
});

describe('useMissingNotePull', () => {
    it('does nothing for a note that is here', async () => {
        const probe = await mount({ isLocal: true });
        expect(probe.state()).toBe('none');
        expect(mocks.getNote).not.toHaveBeenCalled();
        await probe.unmount();
    });

    it('waits while no sync has finished this launch, and the sync brings the note', async () => {
        mocks.sync = { syncStatus: 'syncing', lastSyncResult: null };
        const probe = await mount();
        expect(probe.state()).toBe('loading');
        expect(mocks.getNote).not.toHaveBeenCalled();

        mocks.sync = { syncStatus: 'idle', lastSyncResult: SYNCED };
        await probe.update({ isLocal: true });
        expect(probe.state()).toBe('none');
        expect(mocks.getNote).not.toHaveBeenCalled();
        await probe.unmount();
    });

    it('after the sync, fetches the one note by id and stays loading until it is listed', async () => {
        const probe = await mount();
        expect(mocks.getNote).toHaveBeenCalledWith(NOTE, undefined, { decrypt: false });
        expect(mocks.handleRemoteNote).toHaveBeenCalledWith(HEADER);
        expect(probe.state()).toBe('loading');

        await probe.update({ isLocal: true });
        expect(probe.state()).toBe('none');
        expect(probe.seen).not.toContain('not-found');
        await probe.unmount();
    });

    it('says not found when the server has no such note', async () => {
        mocks.getNote.mockResolvedValue(null);
        const probe = await mount();
        expect(mocks.handleRemoteNote).not.toHaveBeenCalled();
        expect(probe.state()).toBe('not-found');
        await probe.unmount();
    });

    it('says not found when the fetch fails or the pull does not store the note', async () => {
        mocks.getNote.mockRejectedValueOnce(new Error('500'));
        const failed = await mount();
        expect(failed.state()).toBe('not-found');
        await failed.unmount();

        mocks.getSearchIndexEntry.mockResolvedValue(null);
        const skipped = await mount();
        expect(skipped.state()).toBe('not-found');
        await skipped.unmount();
    });

    it('offline: says so, then fetches once the app is back online', async () => {
        mocks.online.isOnline = false;
        const probe = await mount();
        expect(probe.state()).toBe('offline');
        expect(mocks.getNote).not.toHaveBeenCalled();

        mocks.online.isOnline = true;
        await probe.rerender();
        expect(mocks.getNote).toHaveBeenCalledTimes(1);
        expect(probe.state()).toBe('loading');
        await probe.unmount();
    });

    it('fetches nothing for an inactive tab or once the user has left the note', async () => {
        mocks.sync = { syncStatus: 'syncing', lastSyncResult: null };
        const probe = await mount();
        await probe.update({ noteId: undefined });
        mocks.sync = { syncStatus: 'idle', lastSyncResult: SYNCED };
        await probe.rerender();
        expect(probe.state()).toBe('none');
        expect(mocks.getNote).not.toHaveBeenCalled();
        await probe.unmount();
    });

    it('fetches the same id only once, even across later syncs', async () => {
        mocks.getNote.mockResolvedValue(null);
        const probe = await mount();
        mocks.sync = { syncStatus: 'syncing', lastSyncResult: SYNCED };
        await probe.rerender();
        mocks.sync = { syncStatus: 'idle', lastSyncResult: { ...SYNCED } };
        await probe.rerender();
        await probe.update({ noteId: undefined });
        await probe.update({ noteId: NOTE });
        expect(mocks.getNote).toHaveBeenCalledTimes(1);
        expect(probe.state()).toBe('not-found');
        await probe.unmount();
    });
});
