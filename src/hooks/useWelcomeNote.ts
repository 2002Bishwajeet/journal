import { useEffect, useRef } from 'react';
import { useDotYouClientContext } from '@/components/auth';
import { useSyncService } from '@/hooks/useSyncService';
import { useCanEditAnswer } from '@/hooks/useCanEdit';

/**
 * First sign-in (#1283): once the first sync has settled, seed the "Welcome to Journal" note for
 * an identity with no notes and open it. The decision lives in `seedWelcomeNote`.
 */
export function useWelcomeNote(open: (note: { docId: string; folderId: string }) => void): void {
    const client = useDotYouClientContext();
    const { syncStatus, lastSyncedAt } = useSyncService();
    const canEdit = useCanEditAnswer() === true;
    const started = useRef(false);
    // E2E specs that count notes or expect the empty state start without it (e2e/fixtures/hermetic-auth.json).
    const skipped = import.meta.env.MODE === 'e2e' && !!localStorage.getItem('e2e-skip-welcome-note');
    const settled = syncStatus === 'idle' && !!lastSyncedAt;

    useEffect(() => {
        if (started.current || skipped || !settled || !canEdit) return;
        started.current = true;
        void import('@/lib/onboarding/welcome')
            .then(({ seedWelcomeNote }) => seedWelcomeNote(client))
            .then((note) => note && open(note))
            .catch((err: unknown) => console.warn('[welcome] Could not seed the welcome note:', err));
    });
}
