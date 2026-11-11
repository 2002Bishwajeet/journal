import { describe, expect, it } from 'vitest';
import { getSyncIndicator } from '@/hooks/useSyncIndicator';

const base = { isOnline: true, syncStatus: 'idle' as const, syncProgress: null, failed: 0 };

describe('getSyncIndicator (#1162)', () => {
    it('shows nothing when idle', () => {
        expect(getSyncIndicator(base)).toBeNull();
    });

    it('shows Syncing… while a sync runs, with a count once progress is known', () => {
        expect(getSyncIndicator({ ...base, syncStatus: 'syncing' })).toEqual({ kind: 'syncing', label: 'Syncing…' });
        expect(
            getSyncIndicator({ ...base, syncStatus: 'syncing', syncProgress: { phase: 'pull', current: 3, total: 12 } }),
        ).toEqual({ kind: 'syncing', label: 'Syncing 3 of 12' });
    });

    it('keeps Syncing… for a single item or an empty total, and never counts past the total', () => {
        const syncing = { ...base, syncStatus: 'syncing' as const };
        expect(getSyncIndicator({ ...syncing, syncProgress: { phase: 'push', current: 1, total: 1 } })?.label).toBe('Syncing…');
        expect(getSyncIndicator({ ...syncing, syncProgress: { phase: 'push', current: 0, total: 0 } })?.label).toBe('Syncing…');
        expect(getSyncIndicator({ ...syncing, syncProgress: { phase: 'images', current: 5, total: 4 } })?.label).toBe('Syncing 4 of 4');
    });

    it('shows Offline, over a running or failed sync', () => {
        for (const syncStatus of ['idle', 'syncing', 'error'] as const) {
            expect(getSyncIndicator({ ...base, isOnline: false, syncStatus, failed: 2 })).toEqual({ kind: 'offline', label: 'Offline' });
        }
    });

    it('offers Retry after a failed sync, over failed items', () => {
        expect(getSyncIndicator({ ...base, syncStatus: 'error', failed: 2 })).toEqual({
            kind: 'error',
            label: "Couldn't sync",
            action: 'retry',
        });
    });

    it('shows a running sync over failed items', () => {
        expect(getSyncIndicator({ ...base, syncStatus: 'syncing', failed: 2 })?.kind).toBe('syncing');
    });

    it('counts changes sync stopped retrying and opens details', () => {
        expect(getSyncIndicator({ ...base, failed: 3 })).toEqual({ kind: 'failed', label: "3 couldn't sync", action: 'details' });
    });
});
