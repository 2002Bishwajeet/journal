import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSearchIndexEntry } from '@/lib/db/queries';
import { useSyncService } from '@/hooks/useSyncService';
import { isValidShareLink } from '@/hooks/useSaveSharedNote';

/**
 * The app path of the note a share link points at, when this Journal has it: the
 * signed-in user's own note, or a note shared with them (a peer copy keeps the
 * owner's uniqueId). Not here yet, it pulls from the owner once first, so a link
 * opened before the first shared pull still lands on the note (#1002).
 */
export async function findSharedNotePath(file: string, pullOwner: () => Promise<void>): Promise<string | null> {
    const local = await getSearchIndexEntry(file);
    if (local) return `/${local.metadata.folderId}/${file}`;
    try {
        await pullOwner();
    } catch (err) {
        console.warn('[useOpenSharedNote] Pull from the owner failed:', err);
    }
    const pulled = await getSearchIndexEntry(file);
    return pulled ? `/${pulled.metadata.folderId}/${file}` : null;
}

/**
 * Drives `/open-shared?identity=…&file=…`, where a signed-in viewer of a share link
 * that is not public lands: opens the note when they have it, else `noAccess`.
 */
export function useOpenSharedNote(): { invalid: boolean; noAccess: boolean } {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const { syncService } = useSyncService();
    const [noAccess, setNoAccess] = useState(false);
    const started = useRef(false);

    const identity = params.get('identity');
    const file = params.get('file');
    const valid = isValidShareLink(identity, file);

    useEffect(() => {
        if (!valid || !syncService || started.current) return;
        started.current = true;
        findSharedNotePath(file!, () => syncService.pullOwnerNow(identity))
            .catch((err: unknown) => {
                console.error('[useOpenSharedNote] Could not look the note up:', err);
                return null;
            })
            .then((path) => {
                if (path) navigate(path, { replace: true });
                else setNoAccess(true);
            });
    }, [valid, syncService, identity, file, navigate]);

    return { invalid: !valid, noAccess };
}
