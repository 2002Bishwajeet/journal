import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSearchIndexEntry } from '@/lib/db/queries';
import { useSyncService } from '@/hooks/useSyncService';
import { useOnlineContext } from '@/hooks/useOnlineContext';
import { isValidShareLink } from '@/hooks/useSaveSharedNote';

/**
 * The app path of the note a share link points at, when this Journal has it: the
 * signed-in user's own note, or a note shared with them (a peer copy keeps the
 * owner's uniqueId).
 */
export async function localNotePath(file: string): Promise<string | null> {
    const local = await getSearchIndexEntry(file);
    return local ? `/${local.metadata.folderId}/${file}` : null;
}

/**
 * `localNotePath`, pulling from the owner once first when the note is not here, so a
 * link opened before the first shared pull still lands on the note (#1002).
 */
export async function findSharedNotePath(file: string, pullOwner: () => Promise<void>): Promise<string | null> {
    const local = await localNotePath(file);
    if (local) return local;
    try {
        await pullOwner();
    } catch (err) {
        console.warn('[useOpenSharedNote] Pull from the owner failed:', err);
    }
    return localNotePath(file);
}

/**
 * Drives `/open-shared?identity=…&file=…`, where a signed-in viewer of a share link
 * that is not public lands: opens the note when they have it, else `noAccess`. A note
 * not here yet may come with the first sync (a fresh device), so a miss waits for that
 * pass to end before pulling from the owner.
 */
export function useOpenSharedNote(): { invalid: boolean; noAccess: boolean } {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const { syncService, syncStatus, lastSyncResult } = useSyncService();
    const { isOnline } = useOnlineContext();
    const [phase, setPhase] = useState<'local' | 'afterSync' | 'noAccess'>('local');
    const started = useRef<'local' | 'afterSync' | null>(null);

    const identity = params.get('identity');
    const file = params.get('file');
    const valid = isValidShareLink(identity, file);
    const firstSyncDone = lastSyncResult !== null || syncStatus === 'error' || !isOnline;

    useEffect(() => {
        // Strict mode runs effects twice; each phase looks up once.
        if (!valid || phase === 'noAccess' || started.current === phase) return;
        let run: Promise<string | null>;
        if (phase === 'local') run = localNotePath(file!);
        else if (syncService && firstSyncDone) run = findSharedNotePath(file!, () => syncService.pullOwnerNow(identity));
        else return;
        started.current = phase;
        run.catch((err: unknown) => {
            console.error('[useOpenSharedNote] Could not look the note up:', err);
            return null;
        }).then((path) => {
            if (path) navigate(path, { replace: true });
            else setPhase(phase === 'local' ? 'afterSync' : 'noAccess');
        });
    }, [valid, phase, syncService, firstSyncDone, identity, file, navigate]);

    return { invalid: !valid, noAccess: phase === 'noAccess' };
}
