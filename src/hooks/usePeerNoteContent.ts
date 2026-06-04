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
 * Drives SyncService.ensurePeerNoteContent on open of a peer note, then
 * revalidates against the author in the background. Local-first: resolves to
 * 'local' instantly when content already exists.
 *
 * Only the resolved result is stored (keyed by request); 'idle' and 'loading'
 * are derived, so the effect never calls setState synchronously.
 */
export function usePeerNoteContent({
    docId,
    authorOdinId,
    isEnabled,
    syncService,
}: UsePeerNoteContentOptions) {
    const [resolved, setResolved] = useState<{ key: string; status: EnsureNoteContentStatus } | null>(null);
    const [attempt, setAttempt] = useState(0);

    const active = isEnabled && !!docId && !!authorOdinId && !!syncService;
    const requestKey = `${docId ?? ''}|${authorOdinId ?? ''}|${attempt}`;

    useEffect(() => {
        if (!active || !docId || !authorOdinId || !syncService) return;
        let cancelled = false;
        (async () => {
            let result;
            try {
                result = await syncService.ensurePeerNoteContent(docId, authorOdinId);
            } catch {
                if (!cancelled) setResolved({ key: requestKey, status: 'error' });
                return;
            }
            if (cancelled) return;
            setResolved({ key: requestKey, status: result.status });
            // Background freshness — only when we served a cached copy. A fresh
            // fetch ('fetched') is already current; 'empty'/failures have nothing
            // to revalidate. No-op when unchanged; merges + broadcasts when newer.
            if (!cancelled && result.status === 'local') {
                try { await syncService.revalidatePeerNote(docId, authorOdinId); } catch { /* best-effort */ }
            }
        })();
        return () => { cancelled = true; };
    }, [active, requestKey, docId, authorOdinId, syncService]);

    // Derived: 'idle' while inactive, 'loading' until the current request resolves.
    const status: PeerNoteContentStatus = !active
        ? 'idle'
        : resolved?.key === requestKey
            ? resolved.status
            : 'loading';

    return {
        status,
        isLoading: status === 'loading',
        // functional setState → stable without useCallback (rerender-functional-setstate)
        retry: () => setAttempt((n) => n + 1),
    };
}
