// @vitest-environment happy-dom
/** #1170: a failed sync leaves SyncProvider in "error" until a sync that doesn't fail. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getLogSnapshot, resetLogForTests, installConsoleCapture } from '@/lib/diagnostics/logBuffer';
import type { SyncResult } from '@/lib/homebase/SyncService';
import type { SyncContextType } from '@/hooks/useSyncService';

const { serviceSync, serviceStatus } = vi.hoisted(() => ({ serviceSync: vi.fn(), serviceStatus: vi.fn(() => 'idle') }));

vi.mock('@/components/auth', () => ({
    useDotYouClientContext: () => ({ getHostIdentity: () => 'me.homebase.test' }),
}));
vi.mock('@/lib/homebase/SyncService', () => ({
    SyncService: class SyncService {
        sync = serviceSync;
        getStatus = serviceStatus;
    },
}));
vi.mock('@/lib/db', () => ({
    migrateExistingDataToSync: vi.fn(),
    needsSyncMigration: async () => false,
    getPendingSyncCount: async () => ({ notes: 0, folders: 0, images: 0, failed: 0 }),
    getAppState: async () => undefined,
    markPendingDelete: vi.fn(),
}));
vi.mock('@/lib/homebase', () => ({ STORAGE_KEY_LAST_SYNC: 'last-sync' }));
vi.mock('@/lib/homebase/shareCircleMigration', () => ({ migrateShareCircle: vi.fn(async () => {}) }));
vi.mock('@/hooks/useJournalWebsocket', () => ({ useJournalWebsocket: () => false }));

import { SyncProvider } from '@/components/providers/SyncProvider';
import { useSyncService } from '@/hooks/useSyncService';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ok = (): SyncResult => ({ pulled: { folders: 0, notes: 1 }, pushed: { folders: 0, notes: 0 }, errors: [] });
const failed = (): SyncResult => ({ pulled: { folders: 0, notes: 0 }, pushed: { folders: 0, notes: 0 }, errors: ['Network Error'], failed: true });
const inProgress = (): SyncResult => ({ pulled: { folders: 0, notes: 0 }, pushed: { folders: 0, notes: 0 }, errors: ['Sync already in progress'], skipped: true });

let root: Root;
let ctx: SyncContextType;
let now = 0;

function Probe() {
    const value = useSyncService();
    useEffect(() => { ctx = value; });
    return null;
}

async function mount() {
    root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(createElement(SyncProvider, null, createElement(Probe))));
}

/** Runs ctx.sync() past its 1 s debounce. */
async function syncNow() {
    now += 2000;
    await act(async () => ctx.sync());
}

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    now = 10_000;
});

afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    serviceSync.mockReset();
    serviceStatus.mockReturnValue('idle');
});

describe('SyncProvider sync error state (#1170)', () => {
    it('goes syncing → error on a failed run and stays there until a sync succeeds', async () => {
        let finish!: (r: SyncResult) => void;
        serviceSync.mockReturnValueOnce(new Promise<SyncResult>((r) => { finish = r; }));
        await mount();
        await vi.waitFor(() => expect(ctx.syncStatus).toBe('syncing'));

        await act(async () => finish(failed()));
        await vi.waitFor(() => expect(ctx.syncStatus).toBe('error'));
        expect(ctx.lastSyncedAt).toBeNull();

        serviceSync.mockResolvedValueOnce(failed());
        await syncNow();
        expect(ctx.syncStatus).toBe('error');

        serviceSync.mockResolvedValueOnce(ok());
        await syncNow();
        expect(ctx.syncStatus).toBe('idle');
        expect(ctx.lastSyncedAt).not.toBeNull();
    });

    it('stays idle for a benign result such as "Sync already in progress"', async () => {
        serviceSync.mockResolvedValue(inProgress());
        await mount();
        await vi.waitFor(() => expect(serviceSync).toHaveBeenCalled());
        await vi.waitFor(() => expect(ctx.syncStatus).toBe('idle'));
    });

    it('logs no result, keeps the status and schedules no retry for a skipped sync (#1491)', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        serviceSync.mockResolvedValue(ok());
        await mount();
        await vi.waitFor(() => expect(ctx.syncStatus).toBe('idle'));
        resetLogForTests();
        serviceSync.mockClear();

        serviceSync.mockResolvedValueOnce(inProgress());
        await syncNow();
        serviceStatus.mockReturnValue('syncing');
        await syncNow();

        expect(ctx.syncStatus).toBe('idle');
        expect(serviceSync).toHaveBeenCalledTimes(1);
        expect(getLogSnapshot().map((e) => e.message).join('\n')).not.toMatch(/finished|errors/);
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(serviceSync).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('logs a real sync error as readable text (#1491)', async () => {
        installConsoleCapture();
        resetLogForTests();
        serviceSync.mockResolvedValue({ ...failed(), errors: ['Request failed with status code 500'] });
        await mount();
        await vi.waitFor(() => expect(ctx.syncStatus).toBe('error'));
        const text = getLogSnapshot().map((e) => e.message).join('\n');
        expect(text).toContain('Sync completed with errors: Request failed with status code 500');
        expect(text).not.toContain('Array(');
    });
});
