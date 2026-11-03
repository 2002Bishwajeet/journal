import { useEffect, useState } from 'react';
import type { LiveBlockKind } from '@/lib/liveBlocks';
import { hasRunLiveBlock, rememberLiveBlockRun } from '@/lib/liveBlockRuns';

/**
 * Whether an html or react block may run (#947). An `untrusted` block asks first, unless
 * this device already ran its code: `checking` while that is looked up, then `ask` until
 * Run, then `run`.
 */
export function useLiveBlockGate(untrusted: boolean, kind: LiveBlockKind, source: string) {
    const [checked, setChecked] = useState<{ kind: LiveBlockKind; source: string; ran: boolean } | null>(null);

    useEffect(() => {
        if (!untrusted) return;
        let cancelled = false;
        void hasRunLiveBlock(kind, source).then((ran) => {
            if (!cancelled) setChecked({ kind, source, ran });
        });
        return () => {
            cancelled = true;
        };
    }, [untrusted, kind, source]);

    // A lookup for other code says nothing about this code.
    const current = checked?.kind === kind && checked.source === source ? checked : null;
    const state: 'run' | 'ask' | 'checking' = !untrusted || current?.ran ? 'run' : current ? 'ask' : 'checking';
    return {
        state,
        run: () => {
            setChecked({ kind, source, ran: true });
            void rememberLiveBlockRun(kind, source);
        },
    };
}
