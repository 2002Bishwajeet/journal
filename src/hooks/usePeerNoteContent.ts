import { useEffect, useState } from 'react';
import type { SyncService, EnsureNoteContentStatus } from '@/lib/homebase/SyncService';

export type PeerNoteContentStatus = EnsureNoteContentStatus | 'idle' | 'loading';

interface UsePeerNoteContentOptions {
    docId: string | undefined;
    authorOdinId: string | undefined;
    isEnabled: boolean;
    syncService: SyncService | null;
}

/**
 * Drives SyncService.ensurePeerNoteContent on open of a peer note.
 * Local-first: resolves to 'local' instantly when content already exists.
 */
export function usePeerNoteContent({
    docId,
    authorOdinId,
    isEnabled,
    syncService,
}: UsePeerNoteContentOptions) {
    const [status, setStatus] = useState<PeerNoteContentStatus>('idle');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!isEnabled || !docId || !authorOdinId || !syncService) {
            setStatus('idle');
            return;
        }
        let cancelled = false;
        setStatus('loading');
        (async () => {
            let result;
            try {
                result = await syncService.ensurePeerNoteContent(docId, authorOdinId);
            } catch {
                if (!cancelled) setStatus('error');
                return;
            }
            if (cancelled) return;
            setStatus(result.status);
            // Background freshness — only when we served a cached copy. A fresh
            // fetch ('fetched') is already current; 'empty'/failures have nothing
            // to revalidate. No-op when unchanged; merges + broadcasts when newer.
            if (!cancelled && result.status === 'local') {
                try { await syncService.revalidatePeerNote(docId, authorOdinId); } catch { /* best-effort */ }
            }
        })();
        return () => { cancelled = true; };
    }, [docId, authorOdinId, isEnabled, syncService, attempt]);

    return {
        status,
        isLoading: status === 'loading',
        // functional setState → stable without useCallback (rerender-functional-setstate)
        retry: () => setAttempt((n) => n + 1),
    };
}
