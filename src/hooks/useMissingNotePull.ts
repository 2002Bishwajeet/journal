import { useEffect, useRef, useState } from 'react';
import { getSearchIndexEntry } from '@/lib/db/queries/documents';
import { useOnlineContext } from './useOnlineContext';
import { useSyncService } from './useSyncService';

export type MissingNoteState = 'none' | 'loading' | 'offline' | 'not-found';

/**
 * A link to one of your notes this device hasn't pulled yet (#1047): wait for the
 * launch's first sync, then fetch that one note by id, once per id. Pass `noteId`
 * undefined while the tab is inactive: nothing is fetched for it then.
 */
export function useMissingNotePull(noteId: string | undefined, isLoading: boolean, isLocal: boolean): MissingNoteState {
    const { syncService, syncStatus, lastSyncResult } = useSyncService();
    const { isOnline } = useOnlineContext();
    const [missing, setMissing] = useState<string | null>(null);
    const started = useRef<string | null>(null);

    const state: MissingNoteState = !noteId || isLocal ? 'none'
        : !isOnline ? 'offline'
        : missing === noteId ? 'not-found'
        : 'loading';
    const syncPending = syncStatus === 'syncing' || (lastSyncResult === null && syncStatus !== 'error');
    const canCheck = state === 'loading' && !isLoading && !syncPending && !!syncService;

    useEffect(() => {
        if (!canCheck || !noteId || !syncService || started.current === noteId) return;
        started.current = noteId;
        (async () => {
            const header = await syncService.getNoteProvider().getNote(noteId, undefined, { decrypt: false });
            if (header) await syncService.handleRemoteNote(header);
            // A pull can skip a note (a planted one, #730): only a stored note will open
            return !!header && !!(await getSearchIndexEntry(noteId));
        })()
            .catch((error) => {
                console.warn('[MissingNotePull] Could not fetch the linked note:', error);
                return false;
            })
            .then((found) => { if (!found) setMissing(noteId); });
    }, [canCheck, noteId, syncService]);

    return state;
}
