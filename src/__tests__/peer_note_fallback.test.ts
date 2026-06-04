import { describe, it, expect } from 'vitest';
import { isPeerContentFailure, isPeerContentReady } from '@/components/editor/peerNoteStatus';

describe('PeerNoteFallback status predicates', () => {
    it('treats only offline/forbidden/notfound/error as failures', () => {
        expect(isPeerContentFailure('offline')).toBe(true);
        expect(isPeerContentFailure('forbidden')).toBe(true);
        expect(isPeerContentFailure('notfound')).toBe(true);
        expect(isPeerContentFailure('error')).toBe(true);
        for (const s of ['local', 'fetched', 'empty', 'idle', 'loading'] as const) {
            expect(isPeerContentFailure(s)).toBe(false);
        }
    });

    it('treats local/fetched/empty as ready (render the editor)', () => {
        expect(isPeerContentReady('local')).toBe(true);
        expect(isPeerContentReady('fetched')).toBe(true);
        expect(isPeerContentReady('empty')).toBe(true);
    });

    it('treats idle/loading and all failures as not ready (spinner/error, never editor)', () => {
        for (const s of ['idle', 'loading', 'offline', 'forbidden', 'notfound', 'error'] as const) {
            expect(isPeerContentReady(s)).toBe(false);
        }
    });
});
